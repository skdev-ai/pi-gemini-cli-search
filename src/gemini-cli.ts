import { spawn, type ChildProcess } from 'node:child_process';
import type { SearchResult, SearchOptions, SearchWarning, SearchError } from './types.js';
import { resolveGroundingUrls } from './url-resolver.js';

/**
 * Extracts markdown links from text using regex.
 * Matches pattern: [text](url)
 * @param text - Text to extract links from
 * @returns Array of URLs found in markdown links
 */
function extractMarkdownLinks(text: string): string[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const urls: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    urls.push(match[2]);
  }

  return urls;
}

/**
 * Executes a search query using the Gemini CLI subprocess.
 * 
 * Spawns `gemini -o stream-json -p "<prompt>" --yolo -m <model>` and parses
 * the NDJSON output to extract the assistant's answer and grounding sources.
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
      onUpdate('Starting search…');
    }

    // Spawn subprocess with stream-json output
    const child: ChildProcess = spawn('gemini', [
      '-o', 'stream-json',
      '-p', prompt,
      '--yolo',
      '-m', model,
    ]);

    let answerText = '';
    let searchDetected = false;
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

    // Parse stdout line-by-line (NDJSON format)
    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        try {
          const event = JSON.parse(line);

          // Track tool_use events to detect google_web_search usage
          if (event.type === 'tool_use' && event.tool_name === 'google_web_search') {
            searchDetected = true;
          }

          // Concatenate assistant message chunks (format: {"type":"message","role":"assistant","content":"...","delta":true})
          if (event.type === 'message' && event.role === 'assistant' && event.content) {
            answerText += event.content;
          }

          // Ignore user, system, init, tool_result, and result events
        } catch (parseError) {
          // Skip malformed JSON lines
          console.warn('Failed to parse NDJSON line:', line);
        }
      }
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
            message: 'Gemini CLI not found. Please install with: npm install -g @anthropics/gemini-cli',
          };
          resolve({
            answer: '',
            sources: [],
            error,
          });
          return;
        }

        // Check for authentication errors
        if (stderrOutput.toLowerCase().includes('auth') || stderrOutput.toLowerCase().includes('token')) {
          const error: SearchError = {
            type: 'NOT_AUTHENTICATED',
            message: 'Gemini CLI authentication failed. Please run: gemini auth login',
          };
          resolve({
            answer: '',
            sources: [],
            error,
          });
          return;
        }

        // Generic process error
        const error: SearchError = {
          type: 'SEARCH_FAILED',
          message: `Gemini CLI exited with code ${code}: ${stderrOutput}`,
        };
        resolve({
          answer: '',
          sources: [],
          error,
        });
        return;
      }

      // Notify parsing
      if (onUpdate) {
        onUpdate('Parsing response…');
      }

      // Extract markdown links from answer text
      const extractedUrls = extractMarkdownLinks(answerText);

      // Notify URL resolution
      if (onUpdate && extractedUrls.length > 0) {
        onUpdate(`Resolving ${extractedUrls.length} source URLs…`);
      }

      // Resolve grounding URLs
      const groundingUrls = await resolveGroundingUrls(extractedUrls);

      // Build warning if no search was detected
      let warning: SearchWarning | undefined;
      if (!searchDetected) {
        warning = {
          type: 'NO_SEARCH',
          message: 'Gemini answered from memory without using google_web_search tool. Information may be outdated.',
        };
      }

      // Notify complete
      if (onUpdate) {
        onUpdate('Complete');
      }

      resolve({
        answer: answerText,
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
          message: 'Gemini CLI not found. Please install with: npm install -g @anthropics/gemini-cli',
        };
        resolve({
          answer: '',
          sources: [],
          error,
        });
      } else {
        const error: SearchError = {
          type: 'PARSE_ERROR',
          message: `Failed to spawn Gemini CLI: ${err.message}`,
        };
        resolve({
          answer: '',
          sources: [],
          error,
        });
      }
    });
  });
}
