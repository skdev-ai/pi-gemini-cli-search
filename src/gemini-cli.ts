import { spawn, type ChildProcess } from 'node:child_process';
import type { SearchResult, SearchOptions, SearchWarning, SearchError } from './types.js';
import { resolveGroundingUrls } from './url-resolver.js';

/**
 * Extracts markdown links from text using regex.
 * Matches pattern: [text](url)
 * @param text - Text to extract links from
 * @returns Array of { title, url } found in markdown links
 */
function extractMarkdownLinks(text: string): Array<{ title: string; url: string }> {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: Array<{ title: string; url: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    links.push({ title: match[1], url: match[2] });
  }

  return links;
}

/**
 * Strips markdown links from text, replacing [title](url) with just the title.
 * Used to clean the answer text after extracting URLs separately.
 */
function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/**
 * Executes a search query using the Gemini CLI subprocess.
 *
 * Spawns `gemini -o text -p "<prompt>" --yolo -m <model>` and parses
 * the text output to extract the assistant's answer and grounding source URLs.
 *
 * Uses `-o text` instead of `-o stream-json` because stream-json strips
 * grounding redirect URLs from the output. Only text format preserves them.
 *
 * @param query - The search query to execute
 * @param options - Optional search configuration (model, timeout, abort signal, onUpdate callback)
 * @returns Promise resolving to SearchResult with answer, sources, and optional warning/error
 */
export async function executeSearch(
  query: string,
  options?: SearchOptions
): Promise<SearchResult> {
  const model = options?.model ?? process.env.GEMINI_SEARCH_MODEL ?? 'gemini-2.5-flash';
  const timeout = options?.timeout ?? Number(process.env.GEMINI_SEARCH_TIMEOUT ?? 60000);
  const signal = options?.signal;
  const onUpdate = options?.onUpdate;

  // Build prompt using CCS template with explicit search instruction
  const prompt = `Use the google_web_search tool to search for current information about: ${query}`;

  return new Promise((resolve) => {
    // Notify start
    if (onUpdate) {
      onUpdate('Searching…');
    }

    // Spawn subprocess with text output (not stream-json — see docstring)
    const child: ChildProcess = spawn('gemini', [
      '-o', 'text',
      '-p', prompt,
      '--yolo',
      '-m', model,
    ]);

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let timeoutId: NodeJS.Timeout | null = null;

    // Set up timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        const error: SearchError = {
          type: 'TIMEOUT',
          message: `Search timed out after ${timeout}ms`,
        };
        child.kill();
        resolve({
          answer: '',
          sources: [],
          error,
        });
      }, timeout);
    }

    // Handle abort signal
    if (signal) {
      signal.addEventListener('abort', () => {
        const error: SearchError = {
          type: 'SEARCH_FAILED',
          message: 'Search was cancelled',
        };
        child.kill();
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          answer: '',
          sources: [],
          error,
        });
      });
    }

    // Collect stdout
    child.stdout?.on('data', (data: Buffer) => {
      stdoutChunks.push(data.toString());
    });

    // Capture stderr for error diagnosis
    child.stderr?.on('data', (data: Buffer) => {
      stderrChunks.push(data.toString());
    });

    // Handle process exit
    child.on('close', async (code) => {
      if (timeoutId) clearTimeout(timeoutId);

      if (code !== 0 && code !== null) {
        const stderrOutput = stderrChunks.join('');

        // Check for CLI not found (code 127)
        if (code === 127) {
          const error: SearchError = {
            type: 'CLI_NOT_FOUND',
            message: 'Gemini CLI not found. Please install with: npm install -g @google/gemini-cli',
          };
          resolve({ answer: '', sources: [], error });
          return;
        }

        // Check for authentication errors
        if (stderrOutput.toLowerCase().includes('auth') || stderrOutput.toLowerCase().includes('token')) {
          const error: SearchError = {
            type: 'NOT_AUTHENTICATED',
            message: 'Gemini CLI authentication failed. Please run `gemini` to authenticate via browser.',
          };
          resolve({ answer: '', sources: [], error });
          return;
        }

        // Generic process error
        const error: SearchError = {
          type: 'SEARCH_FAILED',
          message: `Gemini CLI exited with code ${code}: ${stderrOutput}`,
        };
        resolve({ answer: '', sources: [], error });
        return;
      }

      const fullText = stdoutChunks.join('');

      if (!fullText.trim()) {
        const error: SearchError = {
          type: 'SEARCH_FAILED',
          message: 'Gemini CLI returned empty response',
        };
        resolve({ answer: '', sources: [], error });
        return;
      }

      // Extract markdown links (grounding redirect URLs)
      const links = extractMarkdownLinks(fullText);
      const urls = links.map(l => l.url);

      // Notify URL resolution
      if (onUpdate && urls.length > 0) {
        onUpdate(`Resolving ${urls.length} source URLs…`);
      }

      // Resolve grounding URLs via HEAD requests
      const groundingUrls = await resolveGroundingUrls(urls);

      // Clean the answer text — strip markdown link syntax, keep display text
      const cleanAnswer = stripMarkdownLinks(fullText);

      // Build warning if no grounding URLs were found
      // (Gemini may have answered from memory without searching)
      let warning: SearchWarning | undefined;
      if (urls.length === 0) {
        warning = {
          type: 'NO_SEARCH',
          message: 'No grounding source URLs found in response. Gemini may have answered from memory — information may not be current.',
        };
      }

      // Notify complete
      if (onUpdate) {
        onUpdate('Complete');
      }

      resolve({
        answer: cleanAnswer,
        sources: groundingUrls,
        warning,
      });
    });

    // Handle spawn errors (e.g., command not found at OS level)
    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);

      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const error: SearchError = {
          type: 'CLI_NOT_FOUND',
          message: 'Gemini CLI not found. Please install with: npm install -g @google/gemini-cli',
        };
        resolve({ answer: '', sources: [], error });
      } else {
        const error: SearchError = {
          type: 'PARSE_ERROR',
          message: `Failed to spawn Gemini CLI: ${err.message}`,
        };
        resolve({ answer: '', sources: [], error });
      }
    });
  });
}

// CLI entry point for standalone execution
if (process.argv[1]?.includes('gemini-cli.ts') && process.argv[2]) {
  const query = process.argv[2];
  executeSearch(query)
    .then(result => {
      if (result.error) {
        console.error(`Error [${result.error.type}]: ${result.error.message}`);
        process.exit(1);
      }
      if (result.warning) {
        console.warn(`Warning: ${result.warning.message}`);
      }
      console.log(result.answer);
      if (result.sources.length > 0) {
        console.log('\nSources:');
        result.sources.forEach((source, i) => {
          console.log(`${i + 1}. ${source.resolved}`);
        });
      }
    })
    .catch(err => {
      console.error('Unexpected error:', err.message);
      process.exit(1);
    });
}
