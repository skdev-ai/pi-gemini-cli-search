/**
 * Transport Cascade Wrapper
 * 
 * Implements unified executeSearch() with intelligent fallback behavior:
 * - A2A transport (primary, multi-session, ~0.6s overhead)
 * - ACP transport (fallback, warm subprocess, ~12s savings per query)
 * - Cold spawn transport (ultimate fallback, always works, ~12s boot)
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
import { getServerState } from './a2a-lifecycle.js';
import { executeSearchCold } from './cold-spawn.js';
import { executeSearchAcp } from './acp.js';

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
  /** Currently active transport ('a2a', 'acp', or 'cold') */
  activeTransport: 'a2a' | 'acp' | 'cold' | null;
  /** Per-transport last error with timestamp */
  a2aLastError: { error: SearchError; timestamp: number } | null;
  acpLastError: { error: SearchError; timestamp: number } | null;
  coldLastError: { error: SearchError; timestamp: number } | null;
  /** Per-transport consecutive failure count */
  a2aConsecutiveFailures: number;
  acpConsecutiveFailures: number;
  coldConsecutiveFailures: number;
}

const transportState: TransportState = {
  activeTransport: null,
  a2aLastError: null,
  acpLastError: null,
  coldLastError: null,
  a2aConsecutiveFailures: 0,
  acpConsecutiveFailures: 0,
  coldConsecutiveFailures: 0,
};

/**
 * Logs a message with [transport] prefix
 */
function log(message: string): void {
  console.log(`[transport] ${message}`);
}

/**
 * Creates a SearchError object from unknown error
 */
function createSearchError(type: SearchError['type'], message: string): SearchError {
  return { type, message };
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
function clearError(transport: 'a2a' | 'acp' | 'cold'): void {
  if (transport === 'a2a') {
    transportState.a2aLastError = null;
    transportState.a2aConsecutiveFailures = 0;
  } else if (transport === 'acp') {
    transportState.acpLastError = null;
    transportState.acpConsecutiveFailures = 0;
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
function cacheError(transport: 'a2a' | 'acp' | 'cold', error: SearchError): void {
  const errorWithTimestamp = { error, timestamp: Date.now() };
  
  if (transport === 'a2a') {
    transportState.a2aLastError = errorWithTimestamp;
    transportState.a2aConsecutiveFailures++;
  } else if (transport === 'acp') {
    transportState.acpLastError = errorWithTimestamp;
    transportState.acpConsecutiveFailures++;
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
 * Resets the transport state to initial values.
 * Called on session_start to clear stale errors from previous session.
 * 
 * @internal Exported for session hygiene, not for general use
 */
export function resetTransportState(): void {
  log('Resetting transport state');
  transportState.activeTransport = null;
  transportState.a2aLastError = null;
  transportState.acpLastError = null;
  transportState.coldLastError = null;
  transportState.a2aConsecutiveFailures = 0;
  transportState.acpConsecutiveFailures = 0;
  transportState.coldConsecutiveFailures = 0;
}

/**
 * Executes a search with intelligent transport cascade.
 * 
 * Cascade order:
 * 1. Check if A2A server is running — if not, skip to ACP
 * 2. Check if A2A has fresh cached error — if yes, skip to ACP
 * 3. Attempt A2A transport
 * 4. On A2A success — cache success, return with transport:'a2a'
 * 5. On A2A error — cache error, fallback to ACP
 * 6. Check if ACP has fresh cached error — if yes, skip to cold
 * 7. Attempt ACP transport
 * 8. On ACP success — cache success, return with transport:'acp'
 * 9. On ACP error — cache error, fallback to cold spawn
 * 10. Execute cold spawn (ultimate fallback)
 * 11. Return cold result with transport:'cold'
 * 
 * Throughout:
 * - Propagates AbortSignal to selected transport
 * - Forwards onUpdate with transport-specific prefix
 * 
 * @param query - The search query
 * @param options - Optional search configuration including signal and onUpdate
 * @returns Promise resolving to SearchResult with transport metadata
 * @throws SearchError if all transports fail
 */
export async function executeSearch(
  query: string,
  options?: SearchOptions
): Promise<SearchResult> {
  const { signal, onUpdate } = options || {};
  
  log(`Starting cascade search for: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);
  
  // Create abort controller for signal propagation
  let abortController: AbortController | null = null;
  
  // Check if signal is already aborted before starting
  if (signal?.aborted) {
    log('Caller signal already aborted, throwing TIMEOUT');
    throw createSearchError('TIMEOUT', 'Search cancelled by user');
  }
  
  // Link caller's abort signal if provided
  if (signal) {
    abortController = new AbortController();
    signal.addEventListener('abort', () => {
      log('Caller aborted, propagating to transport');
      abortController?.abort();
    });
  }
  
  // Helper to wrap onUpdate with transport prefix
  const wrapOnUpdate = (transport: 'a2a' | 'acp' | 'cold'): ((message: string) => void) | undefined => {
    if (!onUpdate) return undefined;
    
    const prefix = transport === 'a2a' ? '[A2A]' : transport === 'acp' ? '[ACP]' : '[Cold]';
    return (message: string) => onUpdate(`${prefix} ${message}`);
  };
  
  // Step 1: Check if A2A server is running
  const serverState = getServerState();
  log(`A2A server status: ${serverState.status}`);
  
  let shouldAttemptA2A = serverState.status === 'running';
  
  if (!shouldAttemptA2A) {
    log('A2A server not running, skipping to cold transport');
    if (onUpdate) {
      onUpdate('[A2A] Skipped (server not running)…');
    }
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
      if (onUpdate) {
        onUpdate('[A2A] Skipped (recent error)…');
      }
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
        // Transport field already set by executeSearchA2A, but explicitly set for clarity
        transport: 'a2a',
      };
    } catch (error) {
      // Step 5: A2A error - cache error, fallback to cold
      const searchError = (error && typeof error === 'object' && 'type' in error) 
        ? (error as SearchError)
        : createSearchError('SEARCH_FAILED', error instanceof Error ? error.message : String(error));
      log(`A2A failed with ${searchError.type}: ${searchError.message}, falling back to cold`);
      if (onUpdate) {
        onUpdate('[A2A] Failed, trying alternative method…');
      }
      
      cacheError('a2a', searchError);
      transportState.activeTransport = 'cold';
      
      // Continue to ACP and cold transport below
    }
  }
  
  // Step 6: Attempt ACP transport (middle tier fallback)
  // Note: No separate ACP availability check needed — if Gemini CLI is installed (checkCliBinary),
  // ACP works. Just try spawning and catch errors (ENOENT = CLI not installed).
  log('Attempting ACP transport...');
  
  // Check if ACP has fresh cached error
  let shouldAttemptAcp = true;
  if (transportState.acpLastError !== null) {
    const { timestamp } = transportState.acpLastError;
    if (isErrorStale(timestamp)) {
      log('ACP error is stale (>5min), will retry ACP');
      // Error is stale - will retry ACP
    } else {
      log('ACP has fresh cached error, skipping to cold transport');
      shouldAttemptAcp = false;
      if (onUpdate) {
        onUpdate('[ACP] Skipped (recent error)…');
      }
    }
  }
  
  if (shouldAttemptAcp) {
    try {
      const result = await executeSearchAcp(query, {
        ...options,
        signal: abortController?.signal,
        onUpdate: wrapOnUpdate('acp'),
      });
      
      // ACP success - cache success, return result
      log('ACP search completed successfully');
      clearError('acp');
      transportState.activeTransport = 'acp';
      
      return {
        ...result,
        transport: 'acp',
      };
    } catch (error) {
      // ACP error - cache error, fall through to cold spawn
      const searchError = (error && typeof error === 'object' && 'type' in error) 
        ? (error as SearchError)
        : createSearchError('SEARCH_FAILED', error instanceof Error ? error.message : String(error));
      log(`ACP failed with ${searchError.type}: ${searchError.message}, falling back to cold spawn`);
      if (onUpdate) {
        onUpdate('[ACP] Failed, trying cold spawn…');
      }
      
      cacheError('acp', searchError);
      transportState.activeTransport = 'cold';
      
      // Continue to cold spawn below
    }
  }
  
  // Step 9: Execute cold spawn (ultimate fallback)
  log('Executing cold spawn transport...');
  
  try {
    const result = await executeSearchCold(query, {
      ...options,
      signal: abortController?.signal,
      onUpdate: wrapOnUpdate('cold'),
    });
    
    // Step 10: Return cold result
    log('Cold spawn search completed');
    
    // Clear cold error on success (R018: errors should be cleared after success)
    clearError('cold');
    transportState.activeTransport = 'cold';
    
    return {
      ...result,
      // Transport field already set by executeSearchCold, but explicitly set for clarity
      transport: 'cold',
    };
  } catch (error) {
    // All transports failed
    const searchError = (error && typeof error === 'object' && 'type' in error) 
      ? (error as SearchError)
      : createSearchError('SEARCH_FAILED', error instanceof Error ? error.message : String(error));
    log(`All transports failed - last error: ${searchError.type}: ${searchError.message}`);
    
    cacheError('cold', searchError);
    transportState.activeTransport = null; // No active transport when all fail
    
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
  cacheError: (transport: 'a2a' | 'acp' | 'cold', error: SearchError) => cacheError(transport, error),
  /** Clear cached error manually */
  clearError: (transport: 'a2a' | 'acp' | 'cold') => clearError(transport),
  /** Set last error with custom timestamp (for TTL testing) */
  setLastError: (transport: 'a2a' | 'acp' | 'cold', error: SearchError, timestamp: number) => {
    if (transport === 'a2a') {
      transportState.a2aLastError = { error, timestamp };
    } else if (transport === 'acp') {
      transportState.acpLastError = { error, timestamp };
    } else {
      transportState.coldLastError = { error, timestamp };
    }
  },
  /** Get consecutive failure count */
  getConsecutiveFailures: (transport: 'a2a' | 'acp' | 'cold') => {
    return transport === 'a2a' ? transportState.a2aConsecutiveFailures : transport === 'acp' ? transportState.acpConsecutiveFailures : transportState.coldConsecutiveFailures;
  },
};
