/**
 * Transport Cascade Unit Tests
 * 
 * Tests for src/transport.ts cascade logic, error TTL, AbortSignal propagation,
 * and progress forwarding. Uses vitest with mocked transports.
 * 
 * Test coverage (20+ tests):
 * - Cascade: A2A succeeds → returns immediately without calling cold
 * - Cascade: A2A fails with fresh error → falls back to cold
 * - Cascade: A2A has stale error → retries A2A instead of falling back
 * - Cascade: A2A not running → skips to cold
 * - TTL decay: 5-minute expiration logic
 * - AbortSignal propagation to both transports
 * - onUpdate forwarding with transport prefix
 * - Error caching with timestamps
 * - getTransportState() accuracy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isErrorStale } from './transport.js';
import type { SearchResult, SearchError } from './types.js';

// Mock the transport implementations
vi.mock('./a2a-transport.js', () => ({
  executeSearchA2A: vi.fn(),
}));

vi.mock('./cold-spawn.js', () => ({
  executeSearchCold: vi.fn(),
}));

vi.mock('./a2a-lifecycle.js', () => ({
  getServerState: vi.fn(),
}));

import { executeSearchA2A } from './a2a-transport.js';
import { executeSearchCold } from './cold-spawn.js';
import { getServerState } from './a2a-lifecycle.js';

// Helper to create mock search results
function createMockResult(transport: 'a2a' | 'cold'): SearchResult {
  return {
    answer: `Mock ${transport} answer`,
    sources: [{ title: 'Example', original: 'https://example.com', resolved: 'https://example.com', resolvedSuccessfully: true }],
    transport,
  };
}

// Helper to create mock errors
function createMockError(type: SearchError['type'], message: string): SearchError {
  return { type, message };
}

describe('Transport Cascade', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Default: A2A server running
    vi.mocked(getServerState).mockReturnValue({
      status: 'running',
      port: 41242,
      uptime: 1000,
      searchCount: 0,
      lastError: null,
      exitCode: null,
      stdoutBuffer: [],
      stderrBuffer: [],
    });
    
    // Reset transport state manually
    const transport = await import('./transport.js');
    transport.__testing__.setState({
      activeTransport: null,
      a2aLastError: null,
      coldLastError: null,
      a2aConsecutiveFailures: 0,
      coldConsecutiveFailures: 0,
    });
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('Cascade Logic', () => {
    it('A2A succeeds → returns immediately without calling cold', async () => {
      const { executeSearch } = await import('./transport.js');
      
      vi.mocked(executeSearchA2A).mockResolvedValue(createMockResult('a2a'));
      
      const result = await executeSearch('test query');
      
      expect(result.transport).toBe('a2a');
      expect(result.answer).toBe('Mock a2a answer');
      expect(executeSearchA2A).toHaveBeenCalledTimes(1);
      expect(executeSearchCold).not.toHaveBeenCalled();
    });
    
    it('A2A fails with fresh error → falls back to cold', async () => {
      const { executeSearch } = await import('./transport.js');
      
      vi.mocked(executeSearchA2A).mockRejectedValue(createMockError('A2A_HUNG', 'Timeout'));
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      
      const result = await executeSearch('test query');
      
      expect(result.transport).toBe('cold');
      expect(result.answer).toBe('Mock cold answer');
      expect(executeSearchA2A).toHaveBeenCalledTimes(1);
      expect(executeSearchCold).toHaveBeenCalledTimes(1);
    });
    
    it('A2A not running → skips to cold without attempting A2A', async () => {
      const { executeSearch } = await import('./transport.js');
      
      vi.mocked(getServerState).mockReturnValue({
        status: 'stopped',
        port: 41242,
        uptime: null,
        searchCount: 0,
        lastError: null,
        exitCode: null,
        stdoutBuffer: [],
        stderrBuffer: [],
      });
      
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      
      const result = await executeSearch('test query');
      
      expect(result.transport).toBe('cold');
      expect(executeSearchA2A).not.toHaveBeenCalled();
      expect(executeSearchCold).toHaveBeenCalledTimes(1);
    });
    
    it('A2A has fresh cached error → skips to cold', async () => {
      const { executeSearch, __testing__ } = await import('./transport.js');
      
      // Manually cache an error
      __testing__.cacheError('a2a', createMockError('A2A_HUNG', 'Previous timeout'));
      
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      
      const result = await executeSearch('test query');
      
      expect(result.transport).toBe('cold');
      expect(executeSearchA2A).not.toHaveBeenCalled();
      expect(executeSearchCold).toHaveBeenCalledTimes(1);
    });
    
    it('A2A has stale cached error → retries A2A', async () => {
      const { executeSearch, __testing__ } = await import('./transport.js');
      
      // Cache an error with stale timestamp (6 minutes ago)
      const staleTimestamp = Date.now() - 6 * 60 * 1000;
      __testing__.setLastError('a2a', createMockError('A2A_HUNG', 'Old timeout'), staleTimestamp);
      
      vi.mocked(executeSearchA2A).mockResolvedValue(createMockResult('a2a'));
      
      const result = await executeSearch('test query');
      
      expect(result.transport).toBe('a2a');
      expect(executeSearchA2A).toHaveBeenCalledTimes(1);
      expect(executeSearchCold).not.toHaveBeenCalled();
    });
    
    it('Both transports fail → throws error', async () => {
      const { executeSearch } = await import('./transport.js');
      
      vi.mocked(executeSearchA2A).mockRejectedValue(createMockError('A2A_HUNG', 'A2A timeout'));
      vi.mocked(executeSearchCold).mockRejectedValue(createMockError('CLI_NOT_FOUND', 'CLI not installed'));
      
      await expect(executeSearch('test query')).rejects.toEqual(
        createMockError('CLI_NOT_FOUND', 'CLI not installed')
      );
    });
  });
  
  describe('Error TTL Logic', () => {
    it('isErrorStale returns false for recent errors (<5min)', () => {
      const recentTimestamp = Date.now() - 2 * 60 * 1000; // 2 minutes ago
      expect(isErrorStale(recentTimestamp)).toBe(false);
    });
    
    it('isErrorStale returns true for old errors (>5min)', () => {
      const oldTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      expect(isErrorStale(oldTimestamp)).toBe(true);
    });
    
    it('isErrorStale returns true for exactly 5 minutes + 1ms', () => {
      const exactTTL = Date.now() - (5 * 60 * 1000 + 1);
      expect(isErrorStale(exactTTL)).toBe(true);
    });
    
    it('isErrorStale returns false for exactly 5 minutes', () => {
      const exactTTL = Date.now() - 5 * 60 * 1000;
      expect(isErrorStale(exactTTL)).toBe(false);
    });
  });
  
  describe('AbortSignal Propagation', () => {
    it('throws immediately if signal is already aborted', async () => {
      const { executeSearch } = await import('./transport.js');
      
      const abortController = new AbortController();
      abortController.abort(); // Pre-abort
      
      await expect(executeSearch('test query', { 
        signal: abortController.signal 
      })).rejects.toMatchObject({
        type: 'TIMEOUT',
        message: 'Search cancelled by user'
      });
      
      // Should not call any transports
      expect(executeSearchA2A).not.toHaveBeenCalled();
      expect(executeSearchCold).not.toHaveBeenCalled();
    });
    
    it('propagates abort signal to A2A transport', async () => {
      const { executeSearch } = await import('./transport.js');
      
      const abortController = new AbortController();
      vi.mocked(executeSearchA2A).mockImplementation(async (_query, options) => {
        // Simulate abort during execution
        setTimeout(() => options?.signal?.dispatchEvent(new Event('abort')), 10);
        return new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(createMockError('TIMEOUT', 'Search cancelled'));
          });
        });
      });
      
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      
      // Start search with abort signal
      const promise = executeSearch('test query', { signal: abortController.signal });
      
      // Abort after a short delay
      setTimeout(() => abortController.abort(), 50);
      
      // Should fallback to cold due to A2A abort
      const result = await promise;
      expect(result.transport).toBe('cold');
    });
    
    it('propagates abort signal to cold transport', async () => {
      const { executeSearch } = await import('./transport.js');
      
      // Make A2A fail immediately to force cold
      vi.mocked(executeSearchA2A).mockRejectedValue(createMockError('A2A_CONNECTION_REFUSED', 'Not running'));
      
      const abortController = new AbortController();
      vi.mocked(executeSearchCold).mockImplementation(async (_query, options) => {
        setTimeout(() => options?.signal?.dispatchEvent(new Event('abort')), 10);
        return new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(createMockError('TIMEOUT', 'Search cancelled'));
          });
        });
      });
      
      const promise = executeSearch('test query', { signal: abortController.signal });
      setTimeout(() => abortController.abort(), 50);
      
      await expect(promise).rejects.toEqual(
        createMockError('TIMEOUT', 'Search cancelled')
      );
    });
  });
  
  describe('Progress Forwarding', () => {
    it('forwards A2A progress with [A2A] prefix', async () => {
      const { executeSearch } = await import('./transport.js');
      
      const progressMessages: string[] = [];
      vi.mocked(executeSearchA2A).mockImplementation(async (_query, options) => {
        options?.onUpdate?.('Connecting to A2A server…');
        options?.onUpdate?.('Searching…');
        options?.onUpdate?.('Complete');
        return createMockResult('a2a');
      });
      
      await executeSearch('test query', {
        onUpdate: (msg) => progressMessages.push(msg),
      });
      
      expect(progressMessages).toEqual([
        '[A2A] Connecting to A2A server…',
        '[A2A] Searching…',
        '[A2A] Complete',
      ]);
    });
    
    it('forwards cold progress with [Cold] prefix', async () => {
      const { executeSearch } = await import('./transport.js');
      
      // Force cold by making A2A fail
      vi.mocked(executeSearchA2A).mockRejectedValue(createMockError('A2A_CONNECTION_REFUSED', 'Not running'));
      
      const progressMessages: string[] = [];
      vi.mocked(executeSearchCold).mockImplementation(async (_query, options) => {
        options?.onUpdate?.('Searching…');
        options?.onUpdate?.('Complete');
        return createMockResult('cold');
      });
      
      await executeSearch('test query', {
        onUpdate: (msg) => progressMessages.push(msg),
      });
      
      expect(progressMessages).toEqual([
        '[A2A] Failed, trying alternative method…',
        '[Cold] Searching…',
        '[Cold] Complete',
      ]);
    });
    
    it('notifies user when A2A is skipped due to server not running', async () => {
      const { executeSearch } = await import('./transport.js');
      
      vi.mocked(getServerState).mockReturnValue({
        status: 'stopped',
        port: 41242,
        uptime: null,
        searchCount: 0,
        lastError: null,
        exitCode: null,
        stdoutBuffer: [],
        stderrBuffer: [],
      });
      
      const progressMessages: string[] = [];
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      
      await executeSearch('test query', {
        onUpdate: (msg) => progressMessages.push(msg),
      });
      
      expect(progressMessages).toContain('[A2A] Skipped (server not running)…');
    });
    
    it('notifies user when A2A is skipped due to fresh error', async () => {
      const transport = await import('./transport.js');
      
      // Cache a fresh error
      transport.__testing__.setLastError('a2a', createMockError('A2A_HUNG', 'Timeout'), Date.now());
      
      const progressMessages: string[] = [];
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      
      await transport.executeSearch('test query', {
        onUpdate: (msg) => progressMessages.push(msg),
      });
      
      expect(progressMessages).toContain('[A2A] Skipped (recent error)…');
    });
    
    it('handles undefined onUpdate gracefully', async () => {
      const { executeSearch } = await import('./transport.js');
      
      vi.mocked(executeSearchA2A).mockResolvedValue(createMockResult('a2a'));
      
      // Should not throw with undefined onUpdate
      await expect(executeSearch('test query')).resolves.toBeDefined();
    });
  });
  
  describe('Error Caching', () => {
    it('caches A2A error with timestamp on failure', async () => {
      const { executeSearch, getTransportState } = await import('./transport.js');
      
      vi.mocked(executeSearchA2A).mockRejectedValue(createMockError('A2A_HUNG', 'Timeout'));
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      
      await executeSearch('test query');
      
      const state = getTransportState();
      expect(state.a2aLastError).toBeDefined();
      expect(state.a2aLastError?.error.type).toBe('A2A_HUNG');
      expect(state.a2aLastError?.timestamp).toBeGreaterThan(Date.now() - 1000);
      expect(state.a2aConsecutiveFailures).toBe(1);
    });
    
    it('clears A2A error on success', async () => {
      const transport = await import('./transport.js');
      
      // First call: A2A fails, falls back to cold
      vi.mocked(executeSearchA2A).mockRejectedValueOnce(createMockError('A2A_HUNG', 'Timeout'));
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      await transport.executeSearch('test query 1');
      
      // Verify error was cached
      let state = transport.getTransportState();
      expect(state.a2aLastError).toBeDefined();
      
      // Second call: A2A succeeds (error was stale from first call? No, it's fresh)
      // Actually with fresh error, cascade skips A2A - so we need to manually clear or wait for TTL
      // For this test, let's manually clear the error to simulate TTL expiry
      transport.__testing__.clearError('a2a');
      
      vi.mocked(executeSearchA2A).mockResolvedValue(createMockResult('a2a'));
      await transport.executeSearch('test query 2');
      
      state = transport.getTransportState();
      expect(state.a2aLastError).toBeNull();
      expect(state.a2aConsecutiveFailures).toBe(0);
    });
    
    it('tracks consecutive failures', async () => {
      const transport = await import('./transport.js');
      
      // Each call will fail on A2A and fall back to cold
      vi.mocked(executeSearchA2A).mockRejectedValue(createMockError('A2A_HUNG', 'Timeout'));
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      
      // First call attempts A2A and fails - error cached, count = 1
      await transport.executeSearch('test query 1');
      
      // Second call skips A2A (fresh error) and goes to cold - doesn't increment A2A count
      // To test consecutive failures, we need stale errors so A2A is retried each time
      transport.__testing__.setLastError('a2a', createMockError('A2A_HUNG', 'Timeout'), Date.now() - 6 * 60 * 1000);
      await transport.executeSearch('test query 2');
      
      // Third call - same setup
      transport.__testing__.setLastError('a2a', createMockError('A2A_HUNG', 'Timeout'), Date.now() - 6 * 60 * 1000);
      await transport.executeSearch('test query 3');
      
      const state = transport.getTransportState();
      expect(state.a2aConsecutiveFailures).toBe(3);
    });
  });
  
  describe('getTransportState()', () => {
    it('returns accurate state after A2A success', async () => {
      const { executeSearch, getTransportState } = await import('./transport.js');
      
      vi.mocked(executeSearchA2A).mockResolvedValue(createMockResult('a2a'));
      
      await executeSearch('test query');
      
      const state = getTransportState();
      expect(state.activeTransport).toBe('a2a');
      expect(state.a2aLastError).toBeNull();
      expect(state.coldLastError).toBeNull();
    });
    
    it('resetTransportState() clears all cached errors', async () => {
      const transport = await import('./transport.js');
      
      // Cache some errors
      transport.__testing__.setLastError('a2a', createMockError('A2A_HUNG', 'Timeout'), Date.now());
      transport.__testing__.setLastError('cold', createMockError('CLI_NOT_FOUND', 'Not installed'), Date.now());
      
      let state = transport.getTransportState();
      expect(state.a2aLastError).toBeDefined();
      expect(state.coldLastError).toBeDefined();
      
      // Reset
      transport.resetTransportState();
      
      state = transport.getTransportState();
      expect(state.a2aLastError).toBeNull();
      expect(state.coldLastError).toBeNull();
      expect(state.activeTransport).toBeNull();
      expect(state.a2aConsecutiveFailures).toBe(0);
      expect(state.coldConsecutiveFailures).toBe(0);
    });
    
    it('returns accurate state after cold fallback', async () => {
      const { executeSearch, getTransportState } = await import('./transport.js');
      
      vi.mocked(executeSearchA2A).mockRejectedValue(createMockError('A2A_HUNG', 'Timeout'));
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      
      await executeSearch('test query');
      
      const state = getTransportState();
      expect(state.activeTransport).toBe('cold');
      expect(state.a2aLastError).toBeDefined();
      expect(state.coldLastError).toBeNull(); // Cold succeeded
    });
    
    it('returns deep copy to prevent external mutation', async () => {
      const { getTransportState } = await import('./transport.js');
      
      const state1 = getTransportState();
      const state2 = getTransportState();
      
      // Mutate state1
      (state1 as any).activeTransport = 'modified';
      
      // state2 should be unaffected
      expect(state2.activeTransport).toBeNull();
    });
  });
  
  describe('Edge Cases', () => {
    it('handles A2A connection refused gracefully', async () => {
      const { executeSearch } = await import('./transport.js');
      
      vi.mocked(executeSearchA2A).mockRejectedValue(createMockError('A2A_CONNECTION_REFUSED', 'ECONNREFUSED'));
      vi.mocked(executeSearchCold).mockResolvedValue(createMockResult('cold'));
      
      const result = await executeSearch('test query');
      
      expect(result.transport).toBe('cold');
      expect(result.answer).toBe('Mock cold answer');
    });
    
    it('handles cold spawn CLI_NOT_FOUND', async () => {
      const { executeSearch } = await import('./transport.js');
      
      vi.mocked(executeSearchA2A).mockRejectedValue(createMockError('A2A_CONNECTION_REFUSED', 'Not running'));
      vi.mocked(executeSearchCold).mockRejectedValue(createMockError('CLI_NOT_FOUND', 'CLI not installed'));
      
      await expect(executeSearch('test query')).rejects.toEqual(
        createMockError('CLI_NOT_FOUND', 'CLI not installed')
      );
    });
    
    it('preserves all search result fields through cascade', async () => {
      const { executeSearch } = await import('./transport.js');
      
      const mockResult: SearchResult = {
        answer: 'Test answer',
        sources: [
          { title: 'Source 1', original: 'https://example.com/1', resolved: 'https://example.com/1', resolvedSuccessfully: true },
          { title: 'Source 2', original: 'https://example.com/2', resolved: 'https://example.com/2', resolvedSuccessfully: true },
        ],
        warning: { type: 'NO_SEARCH', message: 'Gemini may have answered from memory' },
        transport: 'cold',
      };
      
      vi.mocked(executeSearchA2A).mockRejectedValue(createMockError('A2A_CONNECTION_REFUSED', 'Not running'));
      vi.mocked(executeSearchCold).mockResolvedValue(mockResult);
      
      const result = await executeSearch('test query');
      
      expect(result.answer).toBe('Test answer');
      expect(result.sources).toHaveLength(2);
      expect(result.warning?.type).toBe('NO_SEARCH');
      expect(result.transport).toBe('cold');
    });
  });
});
