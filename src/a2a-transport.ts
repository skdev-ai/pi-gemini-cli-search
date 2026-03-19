/**
 * A2A Transport Implementation
 * 
 * Implements the A2A transport tier using fetch for HTTP requests
 * and eventsource-parser for SSE stream parsing. This is the primary
 * transport attempted first in the cascade.
 * 
 * Features:
 * - Connection timeout (500ms) and response timeout (45s)
 * - AbortSignal propagation
 * - Granular progress updates via onUpdate callback
 * - Automatic search count increment after successful searches
 * - Comprehensive error handling with specific error types
 */

import { createParser, type EventSourceMessage } from 'eventsource-parser';
import type { SearchResult, SearchOptions, A2AResult, A2AMessagePart, SearchError, GroundingUrl } from './types.js';
import { SEARCH_MODEL } from './types.js';
import { getServerState, incrementSearchCount } from './a2a-lifecycle.js';

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
 * Logs a message with [a2a-transport] prefix
 */
function log(message: string): void {
  console.log(`[a2a-transport] ${message}`);
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
 * Extracts sources from tool call arguments if available.
 * Returns empty array if no sources found.
 */
function extractSources(result: A2AResult): GroundingUrl[] {
  const parts = result.status.message?.parts || [];
  
  // Look for tool call parts that might contain search results
  for (const part of parts) {
    if (part.kind === 'data' && part.data?.request) {
      const { name, args } = part.data.request;
      
      // Check if this is a google_web_search tool call
      if (name === 'google_web_search' && args && typeof args === 'object') {
        const argsRecord = args as Record<string, unknown>;
        
        // Try to extract sources from various possible structures
        if (Array.isArray(argsRecord.sources)) {
          return argsRecord.sources.map((source: unknown): GroundingUrl => {
            if (typeof source === 'object' && source !== null) {
              const s = source as Record<string, unknown>;
              return {
                title: String(s.title || ''),
                original: String(s.original || ''),
                resolved: String(s.resolved || ''),
                resolvedSuccessfully: Boolean(s.resolvedSuccessfully),
              };
            }
            return { title: '', original: '', resolved: '', resolvedSuccessfully: false };
          });
        }
      }
    }
  }
  
  return [];
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
      'A2A_CONNECTION_REFUSED' as SearchError['type'],
      `A2A server not running (status: ${serverState.status})`
    );
  }
  
  // Create abort controllers for connection and response timeouts
  const connectionController = new AbortController();
  const responseController = new AbortController();
  
  // Set up connection timeout (500ms)
  const connectionTimeoutId = setTimeout(() => {
    if (!connectionController.signal.aborted) {
      connectionController.abort();
    }
  }, CONNECTION_TIMEOUT_MS);
  
  // Set up response timeout (45s total, or env var override)
  const responseTimeoutId = setTimeout(() => {
    if (!responseController.signal.aborted) {
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
    // Build JSON-RPC request envelope
    const requestBody = {
      jsonrpc: '2.0',
      method: 'generate',
      params: {
        prompt: query,
        model: SEARCH_MODEL,
      },
      id: 'search-request',
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
    const resultRef: { current: SearchResult | null } = { current: null };
    let lastKnownState: string | null = null;
    let isComplete = false;
    let accumulatedSources: GroundingUrl[] = [];
    
    // Set up SSE parser
    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        log(`SSE event received: ${event.event || 'message'}`);
        
        if (!event.data) {
          log('No event data');
          return;
        }
        
        try {
          const parsed = JSON.parse(event.data) as { result?: A2AResult };
          const result = parsed.result;
          
          if (!result) {
            log('No result in parsed JSON');
            return;
          }
          
          log(`Result state: ${result.status?.state}, final: ${result.final}`);
          
          // Accumulate sources from tool calls throughout the stream
          const eventSources = extractSources(result);
          if (eventSources.length > 0) {
            log(`Accumulated ${eventSources.length} sources from ${result.status.state} event`);
            accumulatedSources = [...accumulatedSources, ...eventSources];
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
          
          // Check for task completion
          if (result.status.state === 'input-required' && result.final === true) {
            log('Task completed (input-required + final)');
            
            // Extract answer and use accumulated sources
            const answer = extractTextContent(result);
            
            log(`Extracted answer: ${answer.substring(0, 50)}${answer.length > 50 ? '...' : ''}`);
            log(`Total sources: ${accumulatedSources.length}`);
            
            // Store the final result
            resultRef.current = {
              answer,
              sources: accumulatedSources,
              transport: 'a2a' as const,
            };
            
            // Mark as complete
            isComplete = true;
          }
        } catch (parseError) {
          log(`Parse error: ${(parseError as Error).message}`);
          // Don't fail on individual parse errors, continue processing
        }
      },
    });
    
    // Read and parse the stream with abort support
    while (true) {
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: boolean; value?: Uint8Array }>((_, reject) => {
          // Check if already aborted
          if (responseController.signal.aborted) {
            reject(new DOMException('The operation was aborted', 'AbortError'));
            return;
          }
          // Listen for abort event
          responseController.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          }, { once: true });
        }),
      ]);
      
      const { done, value } = result as { done: boolean; value?: Uint8Array };
      
      if (done) {
        log('Stream ended');
        break;
      }
      
      // Convert chunk to string and feed to parser
      const chunk = new TextDecoder().decode(value);
      parser.feed(chunk);
      
      // If we have a complete result, we can stop reading
      if (isComplete && resultRef.current) {
        break;
      }
    }
    
    // Clean up timeouts
    clearTimeout(connectionTimeoutId);
    clearTimeout(responseTimeoutId);
    
    // Check if we got a result
    if (!resultRef.current) {
      log('No result extracted from stream');
      throw createSearchError('PARSE_ERROR', 'Failed to extract result from A2A response stream');
    }
    
    // Increment search count after successful completion
    log('Search completed successfully, incrementing search count');
    await incrementSearchCount();
    
    const resultToReturn = resultRef.current;
    log(`Returning result with ${resultToReturn.sources.length} sources`);
    return resultToReturn;
    
  } catch (error) {
    // Clean up timeouts on error
    clearTimeout(connectionTimeoutId);
    clearTimeout(responseTimeoutId);
    
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
        
        // Determine if it's connection or response timeout
        const connectionTimedOut = connectionController.signal.aborted;
        if (connectionTimedOut) {
          log('Connection timeout (>500ms)');
          throw createSearchError('A2A_CONNECTION_REFUSED', `Connection timeout: A2A server did not respond within ${CONNECTION_TIMEOUT_MS}ms`);
        } else {
          log('Response timeout (>45s) - A2A_HUNG');
          throw createSearchError('A2A_HUNG', `Response timeout: A2A server did not complete within ${getResponseTimeout()}ms`);
        }
      }
    }
    
    // Wrap unknown errors
    log(`Unexpected error: ${(error as Error).message}`);
    throw createSearchError('SEARCH_FAILED', `A2A transport error: ${(error as Error).message}`);
  }
}
