/**
 * A2A Transport Implementation
 * 
 * Implements the A2A transport tier using fetch for HTTP requests
 * and eventsource-parser for SSE stream parsing. This is the primary
 * transport attempted first in the cascade.
 * 
 * Features:
 * - Correct JSON-RPC message/stream format per RESEARCH-gemini-provider-architecture.md
 * - Connection timeout (500ms) and response timeout (45s)
 * - AbortSignal propagation
 * - Granular progress updates via onUpdate callback
 * - Automatic search count increment after successful searches
 * - Comprehensive error handling with specific error types
 * - Identical output processing to cold spawn (extractLinks → resolveGroundingUrls → stripLinks)
 */

import { createParser, type EventSourceMessage } from 'eventsource-parser';
import type { SearchResult, SearchOptions, A2AResult, A2AMessagePart, SearchError, GroundingUrl, SearchWarning } from './types.js';
import { SEARCH_MODEL } from './types.js';
import { getServerState, incrementSearchCount } from './a2a-lifecycle.js';
import { extractLinks, stripLinks } from './gemini-cli.js';
import { resolveGroundingUrls } from './url-resolver.js';
import { debugLog } from './logger.js';

// ============================================================================
// Constants
// ============================================================================

export const A2A_SERVER_URL = 'http://localhost:41242';
export const CONNECTION_TIMEOUT_MS = 500;
export const RESPONSE_TIMEOUT_MS = 45000;

/**
 * Gets the response timeout value, checking environment variable first.
 * Allows tests to override via process.env.A2A_RESPONSE_TIMEOUT_MS
 */
export function getResponseTimeout(): number {
  return Number(process.env.A2A_RESPONSE_TIMEOUT_MS) || RESPONSE_TIMEOUT_MS;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Logs a debug message (hidden unless GCS_DEBUG=1)
 */
function log(message: string): void {
  debugLog('a2a-transport', message);
}

/**
 * Creates a SearchError object with A2A-specific error types
 */
function createSearchError(type: SearchError['type'], message: string): SearchError {
  return { type, message };
}

/**
 * Extracts text content from A2A result parts.
 * CRITICAL: Uses part.kind field (not part.type) to identify text content.
 */
function extractTextContent(result: A2AResult): string {
  const parts = result.status.message?.parts || [];
  const textParts = parts.filter((part: A2AMessagePart) => part.kind === 'text');
  return textParts.map(part => part.text || '').join('');
}

/**
 * Determines progress message based on task state and content.
 * Sends granular updates at meaningful milestones, not every SSE event.
 */
function getProgressMessage(result: A2AResult, lastState: string | null): string | null {
  const state = result.status.state;
  const text = extractTextContent(result);
  
  // State transitions that warrant progress updates
  if (state === 'submitted' && lastState !== 'submitted') {
    return 'Task submitted…';
  }
  
  if (state === 'working') {
    // Check for tool execution
    const parts = result.status.message?.parts || [];
    for (const part of parts) {
      if (part.kind === 'data' && part.data?.request?.name) {
        const toolName = part.data.request.name;
        if (lastState !== 'working' || !text.includes(toolName)) {
          return `Tool executing: ${toolName}…`;
        }
      }
    }
    
    // Generic working state update
    if (lastState !== 'working') {
      return 'Searching…';
    }
  }
  
  if (state === 'input-required' && result.final === true) {
    return 'Complete';
  }
  
  // No update needed
  return null;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Executes a search using the A2A transport.
 * 
 * @param query - The search query
 * @param options - Optional search configuration including signal and onUpdate
 * @returns Promise resolving to SearchResult with transport:'a2a'
 * @throws SearchError with specific A2A error types
 */
export async function executeSearchA2A(
  query: string,
  options?: SearchOptions
): Promise<SearchResult> {
  const { signal, onUpdate } = options || {};
  
  log(`Starting A2A search for: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);
  
  // Check server state before attempting connection
  const serverState = getServerState();
  if (serverState.status !== 'running') {
    log(`Server not running (status: ${serverState.status}), throwing A2A_CONNECTION_REFUSED`);
    throw createSearchError(
      'A2A_CONNECTION_REFUSED',
      `A2A server not running (status: ${serverState.status})`
    );
  }
  
  // Create abort controller for response timeout and caller signal propagation
  const responseController = new AbortController();
  
  // Set up connection timeout (500ms) - fails fast if server doesn't accept connection
  const connectionTimeoutId = setTimeout(() => {
    if (!responseController.signal.aborted) {
      log('Connection timeout (>500ms), aborting request');
      responseController.abort();
    }
  }, CONNECTION_TIMEOUT_MS);
  
  // Set up response timeout (45s total, or env var override)
  const responseTimeoutId = setTimeout(() => {
    if (!responseController.signal.aborted) {
      log('Response timeout, aborting request');
      responseController.abort();
    }
  }, getResponseTimeout());
  
  // Propagate caller's abort signal
  if (signal) {
    signal.addEventListener('abort', () => {
      log('Caller aborted, propagating to fetch request');
      responseController.abort();
    });
  }
  
  try {
    // Build correct JSON-RPC request envelope per RESEARCH-gemini-provider-architecture.md
    const messageId = `msg-${crypto.randomUUID()}`;
    const requestId = `search-${crypto.randomUUID()}`;
    const promptText = `Use the google_web_search tool to search the web for: ${query}. Include source URLs.`;
    
    const requestBody = {
      jsonrpc: '2.0' as const,
      method: 'message/stream' as const,
      id: requestId,
      params: {
        message: {
          role: 'user' as const,
          parts: [{ kind: 'text' as const, text: promptText }],
          messageId,
          metadata: {
            _model: SEARCH_MODEL,
          },
        },
      },
    };
    
    log('Connecting to A2A server...');
    if (onUpdate) {
      onUpdate('Connecting to A2A server…');
    }
    
    // Make the fetch request with streaming
    const response = await fetch(A2A_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
      signal: responseController.signal,
    });
    
    // Clear connection timeout once we have a response
    clearTimeout(connectionTimeoutId);
    log('Connection established');
    
    // Check for authentication errors
    if (response.status === 401) {
      log('Authentication failed (401)');
      throw createSearchError('A2A_AUTH_EXPIRED', `A2A server returned 401 Unauthorized`);
    }
    
    // Check for other HTTP errors
    if (!response.ok) {
      log(`HTTP error: ${response.status} ${response.statusText}`);
      throw createSearchError('SEARCH_FAILED', `A2A server returned ${response.status}: ${response.statusText}`);
    }
    
    // Get the response body stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw createSearchError('PARSE_ERROR', 'No response body received');
    }
    
    // Track parsing state (must be declared before parser callback)
    let rawAnswer = '';
    let lastKnownState: string | null = null;
    let isComplete = false;
    
    // Track approval state for non-YOLO mode
    let taskId: string | null = null;
    let callId: string | null = null;
    let approvalRequired = false;
    
    // Set up SSE parser with error handler for debugging
    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        log(`SSE event received: ${event.event || 'message'}`);
        
        if (!event.data) {
          log('No event data');
          return;
        }
        
        try {
          const parsed = JSON.parse(event.data) as { result?: A2AResult, id?: string };
          const result = parsed.result;
          
          if (!result) {
            log('No result in parsed JSON');
            return;
          }
          
          // Capture taskId from result.id
          if (parsed.id && !taskId) {
            taskId = parsed.id;
            log(`Captured taskId: ${taskId}`);
          }
          
          // Check for tool call data (extract callId)
          const parts = result.status.message?.parts || [];
          for (const part of parts) {
            if (part.kind === 'data' && part.data?.request?.callId) {
              callId = part.data.request.callId;
              log(`Captured callId from tool call: ${callId}`);
            }
          }
          
          log(`Result state: ${result.status?.state}, final: ${result.final}`);
          
          // Only accumulate text from 'text-content' events (not 'thought' or 'tool-call-update')
          const kind = result.metadata?.coderAgent?.kind;
          if (kind === 'text-content') {
            const eventText = extractTextContent(result);
            if (eventText) {
              rawAnswer = rawAnswer + eventText;
              log(`Accumulated text content (total: ${rawAnswer.length} chars)`);
            }
          } else {
            log(`Skipping non-text-content event: ${kind || 'unknown'}`);
          }
          
          // Track state for progress updates
          const lastState = lastKnownState;
          lastKnownState = result.status.state;
          
          // Forward progress updates
          const progressMessage = getProgressMessage(result, lastState);
          if (progressMessage && onUpdate) {
            log(`Progress: ${progressMessage}`);
            onUpdate(progressMessage);
          }
          
          // Check for approval requirement: input-required + final: true + pending tool call
          // IMPORTANT: Only set flag here, don't send approval (can't await in sync callback)
          if (result.status.state === 'input-required' && 
              result.final === true && 
              callId && 
              taskId && 
              !approvalRequired) {
            log('Approval required detected: input-required + final: true with pending tool call');
            approvalRequired = true;
            // Don't mark isComplete=true here - we'll handle approval after stream ends
          }
          
          // Check for task completion (only if approval not required)
          if (result.status.state === 'input-required' && result.final === true && !approvalRequired) {
            log('Task completed (input-required + final)');
            log(`Raw answer length: ${rawAnswer.length}`);
            
            // Mark as complete
            isComplete = true;
          }
        } catch (parseError) {
          log(`Parse error: ${(parseError as Error).message}`);
          // Don't fail on individual parse errors, continue processing
        }
      },
      onError: (error) => {
        log(`SSE parser error: ${error.message}`);
      },
    });
    
    // Create abort promise once (avoids listener accumulation in loop)
    const abortPromise = new Promise<{ done: boolean; value?: Uint8Array }>((_, reject) => {
      // Check if already aborted
      if (responseController.signal.aborted) {
        reject(new DOMException('The operation was aborted', 'AbortError'));
        return;
      }
      // Listen for abort event (once only)
      responseController.signal.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted', 'AbortError'));
      }, { once: true });
    });
    
    // Read and parse the stream with abort support
    while (true) {
      const result = await Promise.race([reader.read(), abortPromise]);
      
      const { done, value } = result as { done: boolean; value?: Uint8Array };
      
      if (done) {
        log('Stream ended');
        
        // Check if stream ended without completion flag
        if (!isComplete && rawAnswer) {
          log(`WARNING: Stream ended prematurely without completion flag. Got ${rawAnswer.length} chars but no input-required+final state.`);
          // Still process the answer but log a warning - better to return partial than nothing
        } else if (!isComplete && !rawAnswer) {
          log('Stream ended with no answer and no completion flag');
          throw createSearchError('PARSE_ERROR', 'A2A stream ended without returning any answer');
        }
        break;
      }
      
      // Convert chunk to string and feed to parser
      const chunk = new TextDecoder().decode(value);
      parser.feed(chunk);
      
      // If we have a complete result, we can stop reading
      if (isComplete) {
        break;
      }
    }
    
    // Clean up timeouts
    clearTimeout(connectionTimeoutId);
    clearTimeout(responseTimeoutId);
    
    // Release reader lock
    await reader.cancel();
    
    // Check if we got an answer
    if (!rawAnswer) {
      log('No answer extracted from stream');
      throw createSearchError('PARSE_ERROR', 'Failed to extract answer from A2A response stream');
    }
    
    // Process answer identically to cold spawn: extractLinks → resolveGroundingUrls → stripLinks
    log('Extracting links from answer...');
    const links = extractLinks(rawAnswer);
    log(`Extracted ${links.length} links from answer`);
    
    // Add NO_SEARCH warning if no links found (same logic and message as cold spawn)
    let warning: SearchWarning | undefined;
    if (links.length === 0) {
      log('No links found in answer - adding NO_SEARCH warning');
      warning = {
        type: 'NO_SEARCH',
        message: 'Gemini may have answered from memory — information may not be current.',
      };
    }
    
    // Resolve grounding URLs
    let sources: GroundingUrl[] = [];
    if (links.length > 0) {
      if (onUpdate) {
        onUpdate(`Resolving ${links.length} source URLs…`);
      }
      log(`Resolving ${links.length} source URLs...`);
      sources = await resolveGroundingUrls(links);
      log(`Resolved ${sources.length} URLs`);
    }
    
    // Strip links from answer text
    const cleanAnswer = stripLinks(rawAnswer);
    log(`Clean answer length: ${cleanAnswer.length}`);
    
    // Increment search count after successful completion (don't fail search if this throws)
    try {
      log('Search completed successfully, incrementing search count');
      await incrementSearchCount();
    } catch (countError) {
      log(`WARNING: Failed to increment search count: ${(countError as Error).message}`);
      // Don't fail the search - counting is observability, not core functionality
    }
    
    const resultToReturn: SearchResult = {
      answer: cleanAnswer,
      sources,
      transport: 'a2a',
      ...(warning ? { warning } : {}),
    };
    
    log(`Returning result with ${resultToReturn.sources.length} sources`);
    return resultToReturn;
    
  } catch (error) {
    // Clean up timeouts on error
    clearTimeout(connectionTimeoutId);
    clearTimeout(responseTimeoutId);
    
    // Note: reader.cancel() is not called here because:
    // 1. If error occurs before reader acquisition, reader doesn't exist yet
    // 2. If error occurs during streaming, the stream is already broken
    // 3. Node.js will GC the reader when response goes out of scope
    // Explicit cancel would only be needed for graceful aborts, not errors
    
    // Re-throw SearchErrors as-is (already properly typed)
    if (error && typeof error === 'object' && 'type' in error) {
      throw error;
    }
    
    // Handle specific error types
    if (error instanceof Error) {
      const err = error as NodeJS.ErrnoException & { cause?: unknown };
      
      // Check for connection refused
      if (err.code === 'ECONNREFUSED') {
        log('Connection refused (ECONNREFUSED)');
        throw createSearchError('A2A_CONNECTION_REFUSED', `Cannot connect to A2A server at ${A2A_SERVER_URL}`);
      }
      
      // Check for abort (timeout or cancellation)
      if (err.name === 'AbortError') {
        if (signal?.aborted) {
          log('Request aborted by caller');
          throw createSearchError('TIMEOUT', 'Search cancelled by user');
        }
        
        // All abort timeouts during streaming are A2A_HUNG
        // (connection was established but server didn't complete)
        log('Response timeout - A2A_HUNG');
        throw createSearchError('A2A_HUNG', `Response timeout: A2A server did not complete within ${getResponseTimeout()}ms`);
      }
    }
    
    // Wrap unknown errors
    log(`Unexpected error: ${(error as Error).message}`);
    throw createSearchError('SEARCH_FAILED', `A2A transport error: ${(error as Error).message}`);
  }
}
