import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { executeSearch, resetTransportState } from "./transport.js";
import type { SearchResult } from "./types.js";
import { get, set, clear as clearCache } from "./cache.js";
import { checkAvailability } from "./availability.js";
import { installA2AServer } from "./a2a-installer.js";
import { startServer, getServerState, stopServer, resetManualStopFlag } from "./a2a-lifecycle.js";
import { getTransportState } from "./transport.js";
import { getAcpState } from "./acp.js";
import { debugLog } from "./logger.js";
import { enableOverride, disableOverride, shouldAutoEnableOverride, persistOverride, clearPersistedOverride, clearOverride } from "./override.js";

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

/**
 * Debug flag - set GCS_DEBUG=1 to enable verbose logging
 */

/**
 * Logs a message only if GCS_DEBUG is enabled
 */
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
        debugLog('index',`Cache hit for query: ${params.query}`);
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
  
  // Register unified /gcs command with subcommands
  pi.registerCommand('gcs', {
    description: 'gemini-cli-search: status | install-a2a | override [true|false] | server [start|stop|restart]',
    handler: async (args: any, ctx: any) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = parts[0];
      
      try {
        if (subcommand === 'status') {
          // Existing /gcs-status logic
          const a2aState = getServerState();
          const transportState = getTransportState();
          const acpState = getAcpState();
          
          const lines: string[] = [];
          lines.push(`**A2A Server Status:**`);
          lines.push(`- Status: \`${a2aState.status}\``);
          lines.push(`- Port: \`${a2aState.port}\``);
          
          if (a2aState.uptime && a2aState.uptime > 0) {
            lines.push(`- Uptime: \`${Math.round(a2aState.uptime / 1000)}s\``);
          }
          
          lines.push(`- Search Count: \`${a2aState.searchCount}\``);
          
          if (a2aState.exitCode !== null) {
            lines.push(`- Exit Code: \`${a2aState.exitCode}\``);
          }
          
          if (a2aState.lastError) {
            lines.push(`- Last Error: \`${a2aState.lastError.type}: ${a2aState.lastError.message}\``);
          }
          
          // Show last 10 lines of stderr/stdout buffers if available
          if (a2aState.stderrBuffer && a2aState.stderrBuffer.length > 0) {
            const recentStderr = a2aState.stderrBuffer.slice(-10);
            lines.push(`- Recent Stderr:`);
            recentStderr.forEach(line => lines.push(`  \`${line}\``));
          }
          
          if (a2aState.stdoutBuffer && a2aState.stdoutBuffer.length > 0) {
            const recentStdout = a2aState.stdoutBuffer.slice(-10);
            lines.push(`- Recent Stdout:`);
            recentStdout.forEach(line => lines.push(`  \`${line}\``));
          }
          
          // Add ACP state
          lines.push('');
          lines.push(`**ACP Transport:**`);
          lines.push(`- Status: \`${acpState.status}\``);
          lines.push(`- Session Count: \`${acpState.sessionCount}/20\``);
          if (acpState.uptime && acpState.uptime > 0) {
            lines.push(`- Uptime: \`${Math.round(acpState.uptime / 1000)}s\``);
          }
          if (acpState.lastError) {
            lines.push(`- Last Error: \`${acpState.lastError.type}\``);
          }
          
          // Add transport layer diagnostics
          lines.push('');
          lines.push(`**Transport Layer:**`);
          lines.push(`- Active Transport: \`${transportState.activeTransport ?? 'none'}\``);
          lines.push(`- A2A Consecutive Failures: \`${transportState.a2aConsecutiveFailures}\``);
          lines.push(`- ACP Consecutive Failures: \`${transportState.acpConsecutiveFailures}\``);
          lines.push(`- Cold Consecutive Failures: \`${transportState.coldConsecutiveFailures}\``);
          
          if (transportState.a2aLastError) {
            const age = Math.round((Date.now() - transportState.a2aLastError.timestamp) / 1000);
            lines.push(`- A2A Last Error: \`${transportState.a2aLastError.error.type} (${age}s ago)\``);
          }
          
          if (transportState.acpLastError) {
            const age = Math.round((Date.now() - transportState.acpLastError.timestamp) / 1000);
            lines.push(`- ACP Last Error: \`${transportState.acpLastError.error.type} (${age}s ago)\``);
          }
          
          if (transportState.coldLastError) {
            const age = Math.round((Date.now() - transportState.coldLastError.timestamp) / 1000);
            lines.push(`- Cold Last Error: \`${transportState.coldLastError.error.type} (${age}s ago)\``);
          }
          
          ctx.ui.notify(lines.join('\n'), 'info');
        }
        
        else if (subcommand === 'install-a2a') {
          // Existing /gcs-install-a2a logic
          await installA2AServer({
            ui: {
              notify: (message) => ctx.ui.notify(message),
              confirm: async (message, options) => {
                // GSD's ctx.ui.confirm(title, detail) takes two strings, not an options object
                const title = options?.title || 'Confirm Installation';
                const detail = options?.detail || message;
                const result = await ctx.ui.confirm(title, detail);
                return result;
              },
            },
          });
          
          // Auto-start A2A server immediately after successful installation
          ctx.ui.notify('A2A installation complete! Starting server...', 'success');
          try {
            await startServer();
            ctx.ui.notify('A2A server started successfully. Ready to use!', 'success');
          } catch (startErr) {
            const startMessage = startErr instanceof Error ? startErr.message : String(startErr);
            ctx.ui.notify(`Installation succeeded but server failed to start: ${startMessage}`, 'warning');
          }
        }
        
        else if (subcommand === 'override') {
          const action = parts[1];
          if (action === 'true') {
            enableOverride(pi);
            persistOverride();
            ctx.ui.notify('gemini-cli-search is now the primary search provider (persistent)', 'info');
          } else if (action === 'false') {
            disableOverride(pi);
            clearPersistedOverride();
            ctx.ui.notify('Default search providers restored', 'info');
          } else {
            ctx.ui.notify('Usage: /gcs override [true|false]', 'warning');
          }
        }
        
        else if (subcommand === 'server') {
          const action = parts[1];
          const serverState = getServerState();
          
          if (action === 'start') {
            if (serverState.status === 'running') {
              ctx.ui.notify(`A2A server already running on port ${serverState.port}`, 'info');
            } else {
              await startServer();
              ctx.ui.notify('A2A server started successfully', 'success');
            }
          }
          
          else if (action === 'stop') {
            if (serverState.status === 'stopped') {
              ctx.ui.notify('A2A server is not running', 'info');
            } else {
              await stopServer();
              ctx.ui.notify('A2A server stopped', 'info');
            }
          }
          
          else if (action === 'restart') {
            await stopServer();
            await startServer();
            ctx.ui.notify('A2A server restarted', 'success');
          }
          
          else {
            ctx.ui.notify('Usage: /gcs server [start|stop|restart]', 'warning');
          }
        }
        
        else if (!subcommand) {
          // No subcommand provided - show help
          ctx.ui.notify(
            'Usage: /gcs <subcommand>\n\n' +
            'Subcommands:\n' +
            '  status          — Show transport and server diagnostics\n' +
            '  install-a2a     — Install and patch A2A server\n' +
            '  override true   — Make gemini_cli_search the only search tool\n' +
            '  override false  — Restore default search tools\n' +
            '  server start    — Start A2A server\n' +
            '  server stop     — Stop A2A server\n' +
            '  server restart  — Restart A2A server',
            'info'
          );
        }
        
        else {
          // Unknown subcommand
          ctx.ui.notify(`Unknown subcommand: ${subcommand}\nRun /gcs for available subcommands`, 'error');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Command failed: ${message}`, 'error');
        debugLog('index', `Command '${subcommand}' failed: ${message}`);
      }
    },
  });
  
  // Notify on session start - Fix 14: Use ctx.ui.notify() to integrate with GSD TUI
  pi.on('session_start', async (_event: any, ctx: any) => {
    // Clear cache and reset transport state on session start to prevent stale data
    clearCache();
    resetTransportState();
    clearOverride(); // Reset override state
    resetManualStopFlag(); // Reset manual stop flag for health monitor
    
    const availability = checkAvailability();
    if (availability.available) {
      debugLog('index','Tool available and ready');
      
      // Only start A2A server if it's installed and patched
      // Check a2a-specific availability (not just CLI + credentials)
      const a2aReady = availability.a2a?.installed && availability.a2a?.patched;
      if (a2aReady) {
        // Fire-and-forget A2A server startup (non-blocking)
        // Lifecycle messages ("Starting...", "Server running") are debug-only
        startServer()
          .then(() => debugLog('index','A2A server started successfully'))
          .catch(err => debugLog('index', `A2A startup failed: ${err.message}`));
      } else {
        debugLog('index','A2A server not ready (not installed or patched). Run /gcs install-a2a to set up.');
      }
      
      // Auto-apply override if persisted in config
      if (shouldAutoEnableOverride()) {
        enableOverride(pi);
        debugLog('index', 'Override auto-enabled from config');
      }
      
      // Fix 14: Use ctx.ui.notify() to match GSD extension styling
      const transports = [];
      if (a2aReady) transports.push('A2A ✓');
      transports.push('ACP ✓');
      transports.push('Cold ✓');
      
      const overrideStatus = shouldAutoEnableOverride() ? ' · override active' : '';
      ctx.ui.notify('gemini-cli-search loaded · ' + transports.join(' · ') + overrideStatus, 'info');
    } else {
      // Show warning if tool is unavailable
      ctx.ui.notify(`gemini-cli-search unavailable: ${availability.reason}`, 'warning');
    }
  });
  
  // Graceful shutdown handlers
  // Note: process.on('exit') is synchronous - async operations don't complete
  // Use SIGINT/SIGTERM for async cleanup, then sync kill on exit
  const gracefulShutdown = async (signal: string) => {
    debugLog('index',`Received ${signal}, shutting down A2A server...`);
    try {
      await stopServer();
      debugLog('index','A2A server stopped gracefully');
    } catch (err) {
      debugLog('index',`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  // Fallback: synchronous cleanup if async handlers didn't complete
  process.on('exit', () => {
    // Synchronous cleanup - just log, actual stop happens in signal handlers
    debugLog('index','Process exiting');
  });
}
