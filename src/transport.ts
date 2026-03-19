/**
 * Transport Cascade Wrapper
 * 
 * Implements unified executeSearch() with intelligent fallback behavior:
 * - A2A transport (primary, multi-session, ~0.6s overhead)
 * - Cold spawn transport (fallback, always works, ~12s boot)
 * - 5-minute error TTL decay before retrying failed transports
 * - AbortSignal propagation to selected transport
 * - Progress forwarding with transport-specific prefixes
 * 
 * Verified Wire Formats (from RESEARCH-gemini-provider-architecture.md):
 * 
 * A2A Request Format (src/a2a-transport.ts lines 166-195):
 * ```json
 * {
 *   "jsonrpc": "2.0",
 *   "method": "message/stream",
 *   "id": "search-<uuid>",
 *   "params": {
 *     "message": {
 *       "role": "user",
 *       "parts": [{ "kind": "text", "text": "Use the google_web_search tool to search the web for: <query>. Include source URLs." }],
 *       "messageId": "msg-<uuid>",
 *       "metadata": { "_model": "gemini-3-flash-preview" }
 *     }
 *   }
 * }
 * ```
 * 
 * Cold Spawn Behavior (src/gemini-cli.ts lines 91-240):
 * - Spawns `gemini -o text -p "<prompt>" --yolo -m <model>` subprocess
 * - Extracts links with extractLinks(), resolves with resolveGroundingUrls(), strips with stripLinks()
 * - Adds NO_SEARCH warning if no links found
 * 
 * Cascade Decision Logic (from RESEARCH-gemini-provider-architecture.md "Approach Comparison"):
 * - A2A: Primary (multi-session, concurrent clients, ~0.6s overhead)
 * - Cold: Fallback (always works, ~12s boot amortized)
 * - Error TTL: 5 minutes before retrying failed transport
 */

import type { SearchResult, SearchOptions, SearchError } from './types.js';
import { executeSearchA2A } from './a2a-transport.js';
import { executeSearchCold } from './cold-spawn.js';
import { getServerState } from './a2a-lifecycle.js';

// ============================================================================
// Constants
// ============================================================================

/** Error TTL in milliseconds (5 minutes) */
const ERROR_TTL_MS = 5 * 60 * 1000;

// ============================================================================
// State Machine
// ============================================================================

/**
 * Transport state tracking per-transport errors and cascade decisions.
 * Singleton pattern - single source of truth for transport health.
 */
interface TransportState {
  /** Currently active transport ('a2a' or 'cold') */
  activeTransport: 'a2a' | 'cold' | null;
  /** Per-transport last error with timestamp */
  a2aLastError: { error: SearchError; timestamp: number } | null;
  coldLastError: { error: SearchError; timestamp: number } | null;
  /** Per-transport consecutive failure count */
  a2aConsecutiveFailures: number;
  coldConsecutiveFailures: number;
}

const transportState: TransportState = {
  activeTransport: null,
  a2aLastError: null,
  coldLastError: null,
  a2aConsecutiveFailures: 0,
  coldConsecutiveFailures: 0,
};

/**
 * Logs a message with [transport] prefix
 */
function log(message: string): void {
  console.log(`[transport] ${message}`);
}

// ============================================================================
// Error TTL Logic
// ============================================================================

/**
 * Checks if a cached error is stale (expired TTL).
 * Returns true if error should be ignored and transport retried.
 * 
 * @param timestamp - When the error occurred (Date.now())
 * @returns true if error is older than ERROR_TTL_MS (5 minutes)
 */
export function isErrorStale(timestamp: number): boolean {
  return Date.now() - timestamp > ERROR_TTL_MS;
}

/**
 * Clears a cached error for a specific transport.
 * Called after successful search completion.
 */
function clearError(transport: 'a2a' | 'cold'): void {
  if (transport === 'a2a') {
    transportState.a2aLastError = null;
    transportState.a2aConsecutiveFailures = 0;
  } else {
    transportState.coldLastError = null;
    transportState.coldConsecutiveFailures = 0;
  }
  log(`Cleared cached error for ${transport} transport`);
}

/**
 * Caches an error with timestamp for a specific transport.
 * Called when a transport fails.
 */
function cacheError(transport: 'a2a' | 'cold', error: SearchError): void {
  const errorWithTimestamp = { error, timestamp: Date.now() };
  
  if (transport === 'a2a') {
    transportState.a2aLastError = errorWithTimestamp;
    transportState.a2aConsecutiveFailures++;
  } else {
    transportState.coldLastError = errorWithTimestamp;
    transportState.coldConsecutiveFailures++;
  }
  
  log(`Cached error for ${transport} transport: ${error.type}`);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns the current transport state for diagnostics.
 * Provides complete visibility into cascade decisions and error history.
 * 
 * @returns Current TransportState with per-transport error timestamps
 */
export function getTransportState(): TransportState {
  return { ...transportState };
}

/**
 * Executes a search with intelligent transport cascade.
 * 
 * Cascade order:
 * 1. Check if A2A server is running — if not, skip to cold
 * 2. Check if A2A has fresh cached error — if yes, skip to cold
 * 3. Attempt A2A transport
 * 4. On A2A success — cache success, return with transport:'a2a'
 * 5. On A2A error — cache error, fallback to cold
 * 6. Execute cold spawn
 * 7. Return cold result with transport:'cold'
 * 
 * Throughout:
 * - Propagates AbortSignal to selected transport
 * - Forwards onUpdate with transport-specific prefix
 * 
 * @param query - The search query
 * @param options - Optional search configuration including signal and onUpdate
 * @returns Promise resolving to SearchResult with transport metadata
 * @throws SearchError if both transports fail
 */
export async function executeSearch(
  query: string,
  options?: SearchOptions
): Promise<SearchResult> {
  const { signal, onUpdate } = options || {};
  
  log(`Starting cascade search for: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);
  
  // Create abort controller for signal propagation
  let abortController: AbortController | null = null;
  
  // Link caller's abort signal if provided
  if (signal) {
    abortController = new AbortController();
    signal.addEventListener('abort', () => {
      log('Caller aborted, propagating to transport');
      abortController?.abort();
    });
  }
  
  // Helper to wrap onUpdate with transport prefix
  const wrapOnUpdate = (transport: 'a2a' | 'cold'): ((message: string) => void) | undefined => {
    if (!onUpdate) return undefined;
    
    const prefix = transport === 'a2a' ? '[A2A]' : '[Cold]';
    return (message: string) => onUpdate(`${prefix} ${message}`);
  };
  
  // Step 1: Check if A2A server is running
  const serverState = getServerState();
  log(`A2A server status: ${serverState.status}`);
  
  let shouldAttemptA2A = serverState.status === 'running';
  
  if (!shouldAttemptA2A) {
    log('A2A server not running, skipping to cold transport');
  }
  
  // Step 2: Check if A2A has fresh cached error
  if (shouldAttemptA2A && transportState.a2aLastError !== null) {
    const { timestamp } = transportState.a2aLastError;
    if (isErrorStale(timestamp)) {
      log('A2A error is stale (>5min), will retry A2A');
      // Error is stale - will retry A2A
    } else {
      log('A2A has fresh cached error, skipping to cold transport');
      shouldAttemptA2A = false;
    }
  }
  
  // Step 3: Attempt A2A transport
  if (shouldAttemptA2A) {
    log('Attempting A2A transport...');
    
    try {
      const result = await executeSearchA2A(query, {
        ...options,
        signal: abortController?.signal,
        onUpdate: wrapOnUpdate('a2a'),
      });
      
      // Step 4: A2A success - cache success, return result
      log('A2A search completed successfully');
      clearError('a2a');
      transportState.activeTransport = 'a2a';
      
      return {
        ...result,
        transport: 'a2a',
      };
    } catch (error) {
      // Step 5: A2A error - cache error, fallback to cold
      const searchError = error as SearchError;
      log(`A2A failed with ${searchError.type}: ${searchError.message}, falling back to cold`);
      if (onUpdate) {
        onUpdate('[A2A] Failed, trying alternative method…');
      }
      
      cacheError('a2a', searchError);
      transportState.activeTransport = 'cold';
      
      // Continue to cold transport below
    }
  }
  
  // Step 6: Execute cold spawn
  log('Executing cold spawn transport...');
  
  try {
    const result = await executeSearchCold(query, {
      ...options,
      signal: abortController?.signal,
      onUpdate: wrapOnUpdate('cold'),
    });
    
    // Step 7: Return cold result
    log('Cold spawn search completed');
    
    // Don't clear cold error on success - cold is fallback, we want to track if it was needed
    transportState.activeTransport = 'cold';
    
    return {
      ...result,
      transport: 'cold',
    };
  } catch (error) {
    // Both transports failed
    const searchError = error as SearchError;
    log(`Cold spawn also failed with ${searchError.type}: ${searchError.message}`);
    
    cacheError('cold', searchError);
    
    throw searchError;
  }
}

// ============================================================================
// Testing Exports
// ============================================================================

/**
 * Internal state manipulation for unit tests.
 * DO NOT USE IN PRODUCTION CODE.
 */
export const __testing__ = {
  /** Get current transport state */
  getState: () => transportState,
  /** Set entire transport state (for testing) */
  setState: (state: TransportState) => { Object.assign(transportState, state); },
  /** Cache an error manually */
  cacheError: (transport: 'a2a' | 'cold', error: SearchError) => cacheError(transport, error),
  /** Clear cached error manually */
  clearError: (transport: 'a2a' | 'cold') => clearError(transport),
  /** Set last error with custom timestamp (for TTL testing) */
  setLastError: (transport: 'a2a' | 'cold', error: SearchError, timestamp: number) => {
    if (transport === 'a2a') {
      transportState.a2aLastError = { error, timestamp };
    } else {
      transportState.coldLastError = { error, timestamp };
    }
  },
  /** Get consecutive failure count */
  getConsecutiveFailures: (transport: 'a2a' | 'cold') => {
    return transport === 'a2a' ? transportState.a2aConsecutiveFailures : transportState.coldConsecutiveFailures;
  },
};
