import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { executeSearch } from "./gemini-cli.js";
import type { SearchResult } from "./types.js";
import { get, set, clear as clearCache } from "./cache.js";
import { checkAvailability } from "./availability.js";
import { installA2AServer } from "./a2a-installer.js";
import { startServer, getServerState, stopServer } from "./a2a-lifecycle.js";

/**
 * Gemini CLI Search Extension
 * 
 * Provides a tool for executing web searches via the Gemini CLI subprocess,
 * returning AI-synthesized answers with resolved source URLs.
 */

// ── Tool Schema ──────────────────────────────────────────────────────────────

const SearchParamsSchema = Type.Object({
  query: Type.String({ 
    description: 'Search query for current information, recent events, or live data' 
  }),
});

// ── Result Rendering ────────────────────────────────────────────────────────

/**
 * Renders a successful search result with answer and numbered source links.
 * Displays resolved URLs (not opaque vertexaisearch redirects).
 */
function renderAnswer(result: SearchResult): string {
  const lines: string[] = [];
  
  // Add the answer
  if (result.answer) {
    lines.push(result.answer);
  }
  
  // Add warning if present (Gemini answered from memory)
  if (result.warning) {
    lines.push('');
    lines.push(`⚠️ **${result.warning.message}**`);
  }
  
  // Add sources with resolved URLs
  if (result.sources.length > 0) {
    lines.push('');
    lines.push('**Sources:**');
    result.sources.forEach((source, index) => {
      if (source.resolvedSuccessfully) {
        lines.push(`${index + 1}. ${source.resolved}`);
      } else {
        // Resolution failed — return the original URL (grounding redirects still work in browsers)
        lines.push(`${index + 1}. ${source.original}`);
      }
    });
  }
  
  return lines.join('\n');
}

/**
 * Renders an error result with structured, machine-distinguishable error messages.
 * Helps the LLM understand what went wrong and how to fix it.
 */
function renderError(result: SearchResult): string {
  if (!result.error) {
    return 'Unknown error occurred';
  }
  
  const errorMessages: Record<string, string> = {
    CLI_NOT_FOUND: 'Gemini CLI is not installed or not in PATH',
    NOT_AUTHENTICATED: 'Gemini CLI authentication failed',
    TIMEOUT: 'Search timed out',
    PARSE_ERROR: 'Failed to parse Gemini CLI output',
    SEARCH_FAILED: 'Search operation failed',
  };
  
  const baseMessage = errorMessages[result.error.type] || result.error.message;
  
  return `**Search Error (${result.error.type}):** ${baseMessage}`;
}

// ── Extension Entry Point ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Register the gemini_cli_search tool
  // @ts-expect-error - ExtensionAPI type not available at compile time, but runtime signature accepts single object
  pi.registerTool({
    name: 'gemini_cli_search',
    label: 'Gemini CLI Search',
    description: 'Search the web for current information, recent events, or live data using Gemini CLI. Use this instead of google_search when you need to leverage Gemini\'s reasoning capabilities with grounded search results. Returns AI-synthesized answers with resolved source URLs.',
    parameters: SearchParamsSchema,
    promptGuidelines: [
      'Use this tool when you need current or recent information that may not be in your training data',
      'Use for live data: latest software versions, recent news, current events, newly released documentation',
      'Use when you need AI reasoning over search results, not just a list of links',
      'Do NOT use for historical facts, well-established knowledge, or information unlikely to have changed',
    ].join('\n'),
    
    execute: async (
      _toolCallId: string,
      params: { query: string },
      signal: AbortSignal | undefined,
      onUpdate: ((message: string) => void) | undefined,
      _ctx: unknown
    ) => {
      // Check cache first
      const cached = get(params.query);
      if (cached) {
        console.log('[gemini-cli-search] Cache hit for query:', params.query);
        if (cached.error) {
          return {
            content: [{ type: 'text', text: renderError(cached) }],
          };
        }
        return {
          content: [{ type: 'text', text: renderAnswer(cached) }],
        };
      }
      
      // Check availability before executing
      const availability = checkAvailability();
      if (!availability.available) {
        const errorResult: SearchResult = {
          answer: '',
          sources: [],
          error: {
            type: 'CLI_NOT_FOUND',
            message: availability.reason || 'Gemini CLI not available',
          },
        };
        // Cache the error result
        set(params.query, errorResult);
        return {
          content: [{ 
            type: 'text', 
            text: renderError(errorResult),
          }],
        };
      }
      
      // Execute the search
      const result = await executeSearch(params.query, {
        signal,
        onUpdate,
      });
      
      // Cache the result (including errors/warnings)
      set(params.query, result);
      
      // Render and return the result
      if (result.error) {
        return {
          content: [{ type: 'text', text: renderError(result) }],
        };
      }
      
      return {
        content: [{ type: 'text', text: renderAnswer(result) }],
      };
    },
  });
  
  // Register /gemini install-a2a command (R013)
  pi.registerCommand('/gemini install-a2a', async (ctx: any) => {
    try {
      await installA2AServer({
        ui: {
          notify: (message) => ctx.ui.notify(message),
          confirm: async (message, options) => {
            const result = await ctx.ui.confirm(message, {
              title: options?.title,
              detail: options?.detail,
            });
            return result;
          },
        },
      });
      ctx.ui.notify('A2A installation complete! Run `/gemini status` to verify.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Extract phase from error if available (prereq/install/workspace/patch/verify)
      const phase = (error as any)?.phase || 'unknown';
      const remediation = (error as any)?.remediation || 'Check logs and retry';
      ctx.ui.notify(`Installation failed (${phase}): ${message}. ${remediation}`, 'error');
      console.error('[A2A Install]', phase, error);
    }
  });
  
  // Register /gemini status command for A2A server diagnostics
  pi.registerCommand('/gemini status', async (ctx: any) => {
    const state = getServerState();
    
    const lines: string[] = [];
    lines.push(`**A2A Server Status:**`);
    lines.push(`- Status: \`${state.status}\``);
    lines.push(`- Port: \`${state.port}\``);
    
    if (state.uptime && state.uptime > 0) {
      lines.push(`- Uptime: \`${Math.round(state.uptime / 1000)}s\``);
    }
    
    lines.push(`- Search Count: \`${state.searchCount}\``);
    
    if (state.exitCode !== null) {
      lines.push(`- Exit Code: \`${state.exitCode}\``);
    }
    
    if (state.lastError) {
      lines.push(`- Last Error: \`${state.lastError.type}: ${state.lastError.message}\``);
    }
    
    // Show last 10 lines of stderr/stdout buffers if available
    if (state.stderrBuffer && state.stderrBuffer.length > 0) {
      const recentStderr = state.stderrBuffer.slice(-10);
      lines.push(`- Recent Stderr:`);
      recentStderr.forEach(line => lines.push(`  \`${line}\``));
    }
    
    if (state.stdoutBuffer && state.stdoutBuffer.length > 0) {
      const recentStdout = state.stdoutBuffer.slice(-10);
      lines.push(`- Recent Stdout:`);
      recentStdout.forEach(line => lines.push(`  \`${line}\``));
    }
    
    ctx.ui.notify(lines.join('\n'), 'info');
  });
  
  // Notify on session start
  pi.on('session_start', async () => {
    // Clear cache on session start to prevent stale data
    clearCache();
    
    const availability = checkAvailability();
    if (availability.available) {
      console.log('[gemini-cli-search] Tool available and ready');
      
      // Only start A2A server if it's installed and patched
      // Check a2a-specific availability (not just CLI + credentials)
      const a2aReady = availability.a2a?.installed && availability.a2a?.patched;
      if (a2aReady) {
        // Fire-and-forget A2A server startup (non-blocking)
        startServer()
          .then(() => console.log('[gemini-cli-search] A2A server started successfully'))
          .catch(err => console.error('[gemini-cli-search] A2A startup failed:', err));
      } else {
        console.log('[gemini-cli-search] A2A server not ready (not installed or patched). Run /gemini install-a2a to set up.');
      }
    } else {
      console.log(`[gemini-cli-search] Tool unavailable: ${availability.reason}`);
    }
  });
  
  // Graceful shutdown handlers
  // Note: process.on('exit') is synchronous - async operations don't complete
  // Use SIGINT/SIGTERM for async cleanup, then sync kill on exit
  const gracefulShutdown = async (signal: string) => {
    console.log(`[gemini-cli-search] Received ${signal}, shutting down A2A server...`);
    try {
      await stopServer();
      console.log('[gemini-cli-search] A2A server stopped gracefully');
    } catch (err) {
      console.error('[gemini-cli-search] Error during shutdown:', err);
    }
  };
  
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  // Fallback: synchronous cleanup if async handlers didn't complete
  process.on('exit', () => {
    // Synchronous cleanup - just log, actual stop happens in signal handlers
    console.log('[gemini-cli-search] Process exiting');
  });
}
