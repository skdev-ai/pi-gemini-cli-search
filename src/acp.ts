/**
 * ACP (Agent Client Protocol) Transport Module
 * 
 * Implements warm process reuse for gemini-cli-search.
 * Spawns `gemini --acp` as persistent subprocess, communicates via JSON-RPC 2.0 over stdin/stdout,
 * and reuses a single session across all queries to avoid ~12s boot cost per query.
 * 
 * **Timing:** ACP boot ~12s (once), warm queries ~3-17s (vs ~12-15s cold). Net savings: ~12s per query after first.
 * 
 * **Process lifecycle:**
 * - Process spawned once on first query
 * - Session created once after authentication
 * - Session reused for all subsequent queries
 * - Process restarted after MAX_ACP_QUERIES_BEFORE_RESTART (20) queries to reset context window + memory
 * 
 * @module acp
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { SearchResult, SearchOptions, SearchWarning, SearchError } from './types.js';
import { SEARCH_MODEL } from './types.js';
import { extractLinks, stripLinks } from './gemini-cli.js';
import { resolveGroundingUrls } from './url-resolver.js';

// ============================================================================
// WIRE FORMATS (VERIFIED — Copy Exactly From RESEARCH-acp-warm-process.md)
// ============================================================================
// Protocol uses NDJSON (one JSON-RPC message per line) over stdin/stdout.
// These exact formats must be used for all ACP communication.

/**
 * 1. Initialize Request
 * Sent immediately after spawning subprocess to establish protocol handshake.
 */
// Request:
// {"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"gemini-cli-search","version":"0.1"}}}
//
// Response:
// {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"authMethods":[{"id":"oauth-personal","name":"Log in with Google"},...],"agentInfo":{"name":"gemini-cli","version":"0.33.1"},"agentCapabilities":{"loadSession":true,...}}}

/**
 * 2. Authenticate Request
 * Sent after initialize completes. methodId selects auth provider.
 * Valid methodId values: "oauth-personal", "gemini-api-key", "vertex-ai", "gateway"
 */
// Request:
// {"jsonrpc":"2.0","method":"authenticate","id":2,"params":{"methodId":"oauth-personal"}}
//
// Response:
// {"jsonrpc":"2.0","id":2,"result":{}}

/**
 * 3. Create Session Request (ONCE after authenticate)
 * CRITICAL: This is called ONCE per process lifetime. The returned sessionId is stored
 * and reused for ALL subsequent session/prompt calls. Do NOT call session/new per query.
 * 
 * Note: mcpServers is required (array, can be empty). cwd sets working directory.
 */
// Request:
// {"jsonrpc":"2.0","method":"session/new","id":3,"params":{"cwd":"/home/skello/projects/gemini-cli-search","mcpServers":[]}}
//
// Response:
// {"jsonrpc":"2.0","id":3,"result":{"sessionId":"e942ead3-a083-4f13-8c88-ac0a59215116"}}

/**
 * 4. Send Prompt Request (Search Query) — Reuses SessionId
 * CRITICAL: Use the sessionId from step 3 (create session). Do NOT call session/new again.
 * The actual content comes as streaming notifications (see below).
 */
// Request:
// {"jsonrpc":"2.0","method":"session/prompt","id":4,"params":{"sessionId":"<stored-session-id>","prompt":[{"type":"text","text":"Use the google_web_search tool to search the web for: <query>. Include source URLs."}]}}
//
// Final response:
// {"jsonrpc":"2.0","id":4,"result":{"stopReason":"end_turn"}}

/**
 * 5. Cancel Request (AbortSignal Handling)
 * On signal.abort(): send session/cancel request, wait up to 2s for graceful cancellation,
 * then kill subprocess if still running.
 */
// Request:
// {"jsonrpc":"2.0","method":"session/cancel","id":5,"params":{"sessionId":"<session-id>"}}

/**
 * Streaming Notifications
 * During prompt execution, Gemini CLI sends notifications via session/update method.
 * 
 * Agent message chunks (response text):
 * Text extraction path: params.update.content.text (NOT params.content.text)
 * Concatenate all agent_message_chunk texts to get the full response.
 */
// {
//   "jsonrpc": "2.0",
//   "method": "session/update",
//   "params": {
//     "sessionId": "<session-id>",
//     "update": {
//       "sessionUpdate": "agent_message_chunk",
//       "content": {
//         "type": "text",
//         "text": "Based on current web search results..."
//       }
//     }
//   }
// }

/**
 * Tool call detection (google_web_search):
 * Detection rule: params.update.sessionUpdate === 'tool_call' && params.update.kind === 'search'
 * This restores R010 search verification capability.
 */
// {
//   "jsonrpc": "2.0",
//   "method": "session/update",
//   "params": {
//     "sessionId": "<session-id>",
//     "update": {
//       "sessionUpdate": "tool_call",
//       "toolCallId": "google_web_search-1773767561802",
//       "status": "in_progress",
//       "title": "Searching the web for: \"current price of Bitcoin\"",
//       "content": [],
//       "kind": "search"
//     }
//   }
// }

/**
 * Available commands update (ignore):
 * This notification is sent after session/new completes. Must filter and ignore it.
 */
// {
//   "jsonrpc": "2.0",
//   "method": "session/update",
//   "params": {
//     "sessionId": "<session-id>",
//     "update": {
//       "sessionUpdate": "available_commands_update",
//       "availableCommands": [...]
//     }
//   }
// }

// ============================================================================
// CONSTANTS AND CONFIGURATION
// ============================================================================

const BOOT_TIMEOUT_MS = 20000; // 20s timeout for 12s typical boot + margin
const PROMPT_TIMEOUT_MS = 60000; // 60s timeout for prompt execution
const CANCEL_GRACE_PERIOD_MS = 2000; // Wait 2s for graceful cancellation before killing
const MAX_ACP_QUERIES_BEFORE_RESTART = 20; // Restart after 20 queries to reset context window + memory

// ============================================================================
// TYPES
// ============================================================================

interface AcpState {
  status: 'idle' | 'running' | 'error';
  sessionCount: number;
  lastError: SearchError | null;
  uptime: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  onNotification?: (notification: any) => void;
  timeoutId: NodeJS.Timeout;
}

// ============================================================================
// MODULE STATE
// ============================================================================

let acpProcess: ChildProcess | null = null;
let sessionId: string | null = null;
let requestIdCounter = 0;
let acpQueryCount = 0; // ACP-specific counter (only increments when cascade routes to ACP)
let processStartTime: number | null = null;
let lastAcpError: SearchError | null = null; // Track last error for getAcpState()
const pendingRequests = new Map<number, PendingRequest>();

/**
 * Resets ACP state for diagnostics/testing.
 * Kills any running process and clears all state.
 */
export function resetAcpState(): void {
  if (acpProcess) {
    acpProcess.kill();
    acpProcess = null;
  }
  sessionId = null;
  requestIdCounter = 0;
  acpQueryCount = 0;
  lastAcpError = null;
  processStartTime = null;
  pendingRequests.clear();
  console.log('[acp] State reset');
}

/**
 * Returns current ACP diagnostic state.
 */
export function getAcpState(): AcpState {
  return {
    status: lastAcpError ? 'error' : (acpProcess ? 'running' : 'idle'),
    sessionCount: acpQueryCount,
    lastError: lastAcpError,
    uptime: processStartTime ? Date.now() - processStartTime : 0,
  };
}

/**
 * Sends a JSON-RPC request to the ACP subprocess.
 * Handles request ID generation, pending request tracking, and timeout.
 */
function sendRequest(
  method: string,
  params: Record<string, unknown>,
  onNotification?: (notification: any) => void,
  timeoutMs: number = PROMPT_TIMEOUT_MS
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!acpProcess || !acpProcess.stdin?.writable) {
      reject({ type: 'ACP_BOOT_FAILED', message: 'ACP process not available' });
      return;
    }

    const id = ++requestIdCounter;
    const request = {
      jsonrpc: '2.0',
      method,
      id,
      params,
    };

    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      reject({ type: 'TIMEOUT', message: `ACP request ${method} timed out` });
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, onNotification, timeoutId });

    const line = JSON.stringify(request) + '\n';
    acpProcess.stdin.write(line, (err) => {
      if (err) {
        clearTimeout(timeoutId);
        pendingRequests.delete(id);
        reject({ type: 'PARSE_ERROR', message: `Failed to write to ACP stdin: ${err.message}` });
      }
    });
  });
}

/**
 * Parses incoming JSON-RPC messages and routes them appropriately.
 * Notifications are broadcast to active listeners, responses resolve pending requests.
 */
function handleIncomingMessage(message: any): void {
  if (!message.jsonrpc || message.jsonrpc !== '2.0') {
    console.log('[acp] Ignoring non-JSON-RPC message:', message);
    return;
  }

  // Check if this is a notification (no id field)
  if (message.method === 'session/update' && !message.id) {
    // Filter out available_commands_update notifications
    if (message.params?.update?.sessionUpdate === 'available_commands_update') {
      return; // Ignore
    }

    // Broadcast to all active listeners (should only be one in sequential cascade)
    for (const pending of pendingRequests.values()) {
      if (pending.onNotification) {
        pending.onNotification(message);
      }
    }
    return;
  }

  // This is a response to a request
  const id = message.id;
  const pending = pendingRequests.get(id);
  if (!pending) {
    console.log('[acp] Received response for unknown request ID:', id);
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingRequests.delete(id);

  if (message.error) {
    pending.reject({ type: 'PARSE_ERROR', message: `ACP error: ${message.error.message}` });
  } else {
    pending.resolve(message.result);
  }
}

/**
 * Ensures the ACP subprocess is running and initialized.
 * Spawns process, performs handshake (initialize → authenticate → session/new),
 * and stores sessionId for reuse. Called once per process lifetime.
 */
async function ensureAcpProcess(): Promise<void> {
  // Check if we need to restart due to query count limit
  if (acpProcess && acpQueryCount >= MAX_ACP_QUERIES_BEFORE_RESTART) {
    console.log('[acp] Restarting process after', acpQueryCount, 'queries (context reset)');
    if (acpProcess) {
      acpProcess.kill();
      acpProcess = null;
    }
    sessionId = null;
    acpQueryCount = 0;
    processStartTime = null;
  }

  // Return early if already initialized
  if (acpProcess && sessionId) {
    return;
  }

  console.log('[acp] Spawning gemini --acp subprocess...');
  processStartTime = Date.now();

  return new Promise((resolve, reject) => {
    // Spawn subprocess with stdio pipes
    acpProcess = spawn('gemini', ['--acp', '-m', SEARCH_MODEL], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Set up readline interface for stdout (NDJSON format - one JSON per line)
    const readline = createInterface({
      input: acpProcess.stdout!,
      crlfDelay: Infinity,
    });

    readline.on('line', (line) => {
      try {
        const message = JSON.parse(line);
        handleIncomingMessage(message);
      } catch (err) {
        console.log('[acp] Failed to parse stdout JSON:', line, err);
      }
    });

    // Monitor stderr for auth errors
    acpProcess.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();

      // Check for authentication errors
      if (chunk.includes('FatalAuthenticationError') || chunk.includes('OAuth token expired')) {
        const error: SearchError = {
          type: 'NOT_AUTHENTICATED',
          message: 'Gemini CLI authentication failed. Please run `gemini` to authenticate.',
        };
        console.log('[acp] Authentication error detected:', error.message);
        reject(error);
      }
    });

    // Monitor for unexpected crashes
    acpProcess.on('exit', (code) => {
      console.log('[acp] Process exited with code', code);
      acpProcess = null;
      sessionId = null;
      
      if (code !== 0 && code !== null) {
        const error: SearchError = {
          type: 'ACP_BOOT_FAILED',
          message: `ACP subprocess crashed with exit code ${code}`,
        };
        // Reject any pending requests
        for (const [, pending] of pendingRequests) {
          clearTimeout(pending.timeoutId);
          pending.reject(error);
        }
        pendingRequests.clear();
      }
    });

    // Set boot timeout
    const bootTimeoutId = setTimeout(() => {
      if (acpProcess) {
        acpProcess.kill();
        acpProcess = null;
      }
      readline.close(); // Clean up readline interface on timeout
      const error: SearchError = {
        type: 'TIMEOUT',
        message: `ACP boot timed out after ${BOOT_TIMEOUT_MS}ms`,
      };
      console.log('[acp] Boot timeout:', error.message);
      reject(error);
    }, BOOT_TIMEOUT_MS);

    // Perform handshake: initialize → authenticate → session/new
    const performHandshake = async () => {
      try {
        // Step 1: Initialize
        console.log('[acp] Sending initialize request...');
        await sendRequest('initialize', {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: {
            name: 'gemini-cli-search',
            version: '0.1',
          },
        }, undefined, BOOT_TIMEOUT_MS);
        console.log('[acp] Initialize complete');

        // Step 2: Authenticate (use BOOT_TIMEOUT_MS for handshake)
        console.log('[acp] Sending authenticate request...');
        await sendRequest('authenticate', {
          methodId: 'oauth-personal',
        }, undefined, BOOT_TIMEOUT_MS);
        console.log('[acp] Authentication complete');

        // Step 3: Create session (ONCE per process lifetime) (use BOOT_TIMEOUT_MS)
        console.log('[acp] Creating new session...');
        const sessionResult = await sendRequest('session/new', {
          cwd: process.cwd(),
          mcpServers: [],
        }, undefined, BOOT_TIMEOUT_MS);
        
        sessionId = sessionResult.sessionId;
        console.log('[acp] Session created:', sessionId);

        // Clear boot timeout and resolve
        clearTimeout(bootTimeoutId);
        console.log('[acp] Handshake complete in', Date.now() - (processStartTime ?? 0), 'ms');
        resolve();
      } catch (err) {
        clearTimeout(bootTimeoutId);
        if (acpProcess) {
          acpProcess.kill();
          acpProcess = null;
        }
        reject(err);
      }
    };

    performHandshake();
  });
}

/**
 * Executes a search query using the ACP warm process transport.
 * 
 * Reuses a single session across all queries to avoid ~12s boot cost per query.
 * Automatically restarts the process after MAX_ACP_QUERIES_BEFORE_RESTART queries.
 * 
 * @param query - The search query to execute
 * @param options - Optional search configuration (model, timeout, abort signal, onUpdate callback)
 * @returns Promise resolving to SearchResult with answer, sources, optional warning/error, and transport:'acp'
 */
export async function executeSearchAcp(
  query: string,
  options?: SearchOptions
): Promise<SearchResult> {
  const signal = options?.signal;
  const onUpdate = options?.onUpdate;

  // Notify start
  if (onUpdate) {
    onUpdate('Searching via ACP...');
  }

  try {
    // Increment counter BEFORE ensureAcpProcess so restart check sees updated count
    acpQueryCount++;
    console.log('[acp] Query', acpQueryCount, '/', MAX_ACP_QUERIES_BEFORE_RESTART);

    // Ensure process is running and initialized
    await ensureAcpProcess();

    // Collect response chunks and detect tool calls
    const textChunks: string[] = [];
    let usedSearch = false;

    // Send prompt with stored sessionId (reused across all queries)
    const promptPromise = sendRequest(
      'session/prompt',
      {
        sessionId: sessionId!,
        prompt: [
          {
            type: 'text',
            text: `Use the google_web_search tool to search the web for: ${query}. Include source URLs.`,
          },
        ],
      },
      // Notification handler for streaming updates
      (notification: any) => {
        const update = notification.params?.update;
        if (!update) return;

        // Handle agent message chunks (response text)
        if (update.sessionUpdate === 'agent_message_chunk') {
          const text = update.content?.text;
          if (text) {
            textChunks.push(text);
            if (onUpdate) {
              onUpdate('Receiving response...');
            }
          }
        }

        // Detect tool calls for R010 verification
        if (update.sessionUpdate === 'tool_call' && update.kind === 'search') {
          usedSearch = true;
          console.log('[acp] Tool call detected:', update.title);
        }
      }
    );

    // Handle abort signal
    let cancelled = false;
    if (signal) {
      signal.addEventListener('abort', async () => {
        console.log('[acp] Abort signal received, sending cancel request...');
        cancelled = true;

        try {
          // Send graceful cancellation request with short timeout (2s)
          await sendRequest('session/cancel', {
            sessionId: sessionId!,
          }, undefined, CANCEL_GRACE_PERIOD_MS);

          // Wait up to 2s for graceful cancellation
          await new Promise((cancelResolve) => setTimeout(cancelResolve, CANCEL_GRACE_PERIOD_MS));

          // Kill subprocess if still running
          if (acpProcess) {
            console.log('[acp] Graceful cancel timed out, killing process');
            acpProcess.kill();
            acpProcess = null;
            sessionId = null;
          }
        } catch (err) {
          console.log('[acp] Cancel error:', err);
          // Force kill anyway
          if (acpProcess) {
            acpProcess.kill();
            acpProcess = null;
            sessionId = null;
          }
        }
      });
    }

    // Wait for prompt to complete
    await promptPromise;

    // Check if cancelled
    if (cancelled) {
      const error: SearchError = {
        type: 'SEARCH_FAILED',
        message: 'Search was cancelled',
      };
      throw error;
    }

    // Concatenate all text chunks
    const fullText = textChunks.join('');

    if (!fullText.trim()) {
      const error: SearchError = {
        type: 'SEARCH_FAILED',
        message: 'Gemini CLI returned empty response',
      };
      throw error;
    }

    // Extract links from response text
    const links = extractLinks(fullText);

    // Notify URL resolution
    if (onUpdate && links.length > 0) {
      onUpdate(`Resolving ${links.length} source URLs...`);
    }

    // Resolve grounding URLs via HEAD requests
    const groundingUrls = await resolveGroundingUrls(links);

    // Clean the answer text
    const cleanAnswer = stripLinks(fullText);

    // Warn when no source URLs were extracted
    let warning: SearchWarning | undefined;
    if (links.length === 0) {
      warning = {
        type: 'NO_SEARCH',
        message: 'Gemini may have answered from memory — information may not be current.',
      };
    }

    // Notify complete
    if (onUpdate) {
      onUpdate('Complete');
    }

    console.log('[acp] Query complete, used search:', usedSearch);

    return {
      answer: cleanAnswer,
      sources: groundingUrls,
      warning,
      transport: 'acp',
    };
  } catch (err: any) {
    console.log('[acp] Error:', err.type, err.message);

    // Track error for getAcpState()
    lastAcpError = err as SearchError;

    // Clean up on FATAL errors only - don't kill on transient errors like TIMEOUT
    const fatalErrors = ['ACP_BOOT_FAILED', 'NOT_AUTHENTICATED', 'CLI_NOT_FOUND', 'PARSE_ERROR'];
    if (fatalErrors.includes(err.type) && acpProcess) {
      acpProcess.kill();
      acpProcess = null;
      sessionId = null;
    }

    // THROW for cascade fallback - don't return { error }
    throw err;
  }
}

// CLI entry point for standalone execution
if (process.argv[1]?.includes('acp.ts') && process.argv[2]) {
  const query = process.argv[2];
  executeSearchAcp(query)
    .then((result) => {
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
      console.log('\n[acp] State:', getAcpState());
    })
    .catch((err) => {
      console.error('Unexpected error:', err.message);
      process.exit(1);
    });
}
