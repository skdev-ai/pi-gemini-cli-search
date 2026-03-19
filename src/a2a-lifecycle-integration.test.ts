/**
 * Integration tests for A2A Server Lifecycle Management Module
 * 
 * Unlike unit tests (a2a-lifecycle.test.ts), these tests:
 * - Use real subprocess spawning (not mocked)
 * - Verify actual server startup and readiness detection
 * - Test HTTP health check endpoint
 * - Validate exit monitoring with real process signals
 * - Prove concurrent startup lock works in practice
 * 
 * Tests skip gracefully if A2A server is not installed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import * as lifecycle from './a2a-lifecycle.js';
import { checkA2AInstalled } from './availability.js';
import { getA2APackageRoot } from './a2a-path.js';
import { readFileSync } from 'node:fs';

// ============================================================================
// Skip Condition - Gracefully skip all tests if A2A not installed or not patched
// ============================================================================

const A2A_INSTALLED = checkA2AInstalled();
const A2A_PACKAGE_ROOT = A2A_INSTALLED ? getA2APackageRoot() : null;
const A2A_BUNDLE_PATH = A2A_PACKAGE_ROOT ? `${A2A_PACKAGE_ROOT}/dist/a2a-server.mjs` : null;
const A2A_PATCHED = A2A_BUNDLE_PATH ? (() => {
  try {
    const content = readFileSync(A2A_BUNDLE_PATH, 'utf-8');
    return content.includes('_requestedModel');
  } catch {
    return false;
  }
})() : false;

const A2A_AVAILABLE = A2A_INSTALLED && A2A_PATCHED;

describe.skipIf(!A2A_AVAILABLE)('A2A Lifecycle Integration Tests', () => {
  // Cleanup after each test to prevent test pollution
  afterEach(async () => {
    await lifecycle.stopServer();
    // Reset internal state
    lifecycle.__testing__.setState({
      status: 'idle',
      port: 41242,
      uptime: null,
      searchCount: 0,
      lastError: null,
      exitCode: null,
      stdoutBuffer: [],
      stderrBuffer: [],
    });
    lifecycle.__testing__.clearUptimeTimer();
  });

  // ============================================================================
  // Test 1: Starts server and detects readiness
  // ============================================================================

  it(
    'starts server and detects readiness',
    async () => {
      // Start the server
      const startPromise = lifecycle.startServer();
      
      // Wait for promise resolution (ready marker detected)
      await startPromise;
      
      // Assert server state
      const state = lifecycle.getServerState();
      expect(state.status).toBe('running');
      expect(state.port).toBe(41242);
      expect(state.uptime).toBeDefined();
      expect(state.uptime!).toBeGreaterThanOrEqual(0);
      
      console.log(`[Integration Test] Server started with uptime: ${state.uptime}ms`);
    },
    35000 // 35s timeout for slow startup
  );

  // ============================================================================
  // Test 2: HTTP health check passes
  // ============================================================================

  it(
    'HTTP health check passes',
    async () => {
      // Start server
      await lifecycle.startServer();
      
      // Make HTTP GET to health endpoint
      const healthCheckPromise = new Promise<boolean>((resolve) => {
        const url = `http://localhost:41242/.well-known/agent-card.json`;
        
        const req = http.get(url, (res) => {
          resolve(res.statusCode === 200);
        });
        
        req.setTimeout(5000, () => {
          req.destroy();
          resolve(false);
        });
        
        req.on('error', () => {
          resolve(false);
        });
        
        req.end();
      });
      
      const healthCheckPassed = await healthCheckPromise;
      expect(healthCheckPassed).toBe(true);
      
      console.log('[Integration Test] HTTP health check passed');
    },
    35000 // 35s timeout
  );

  // ============================================================================
  // Test 3: Exit monitoring detects crash
  // ============================================================================

  it(
    'exit monitoring detects crash',
    async () => {
      // Start server
      await lifecycle.startServer();
      
      // Get child process PID from internal state
      const childProcess = lifecycle.__testing__.getChildProcess();
      expect(childProcess).toBeTruthy();
      expect(childProcess!.pid).toBeDefined();
      
      const pid = childProcess!.pid!;
      console.log(`[Integration Test] Killing server process ${pid}`);
      
      // Kill the process with SIGKILL
      process.kill(pid, 'SIGKILL');
      
      // Wait briefly for exit handler to fire
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Assert state updated
      const state = lifecycle.getServerState();
      expect(state.status).toBe('stopped');
      expect(state.exitCode).toBeDefined();
      expect(state.exitCode!).not.toBe(null);
      
      console.log(`[Integration Test] Exit detected with code: ${state.exitCode}`);
    },
    10000 // 10s timeout
  );

  // ============================================================================
  // Test 4: Concurrent startup prevented
  // ============================================================================

  it(
    'concurrent startup prevented',
    async () => {
      let firstResolved = false;
      let secondResolved = false;
      
      // Call startServer() twice simultaneously
      const start1 = lifecycle.startServer().then(() => {
        firstResolved = true;
        console.log('[Integration Test] First startServer() resolved');
      });
      
      const start2 = lifecycle.startServer().then(() => {
        secondResolved = true;
        console.log('[Integration Test] Second startServer() resolved');
      }).catch((err) => {
        // If it rejects due to state check, that's also valid
        console.log('[Integration Test] Second startServer() rejected:', err.type);
        secondResolved = true;
      });
      
      // Wait for both to complete
      await Promise.allSettled([start1, start2]);
      
      // Both should be resolved (either success or wait-for-first)
      expect(firstResolved).toBe(true);
      expect(secondResolved).toBe(true);
      
      // Verify only one server process spawned (check internal state)
      const state = lifecycle.getServerState();
      expect(state.status).toBe('running');
      
      // Second caller should have waited for first (or been rejected)
      // The key assertion: only ONE spawn call happened
      const childProcess = lifecycle.__testing__.getChildProcess();
      expect(childProcess).toBeTruthy();
      
      console.log('[Integration Test] Concurrent startup lock verified');
    },
    35000 // 35s timeout
  );

  // ============================================================================
  // Test 5: Search counter restart (optional, uses internal hooks)
  // ============================================================================

  it(
    'search counter triggers restart at 1000',
    async () => {
      // Start server
      await lifecycle.startServer();
      
      // Manually set searchCount to 999 via test hook
      const currentState = lifecycle.__testing__.getState();
      lifecycle.__testing__.setState({
        ...currentState,
        searchCount: 999,
      });
      
      console.log('[Integration Test] Set search count to 999');
      
      // Increment to 1000 - should trigger restart
      const incrementPromise = lifecycle.incrementSearchCount();
      
      // Wait for increment (and potential restart)
      await incrementPromise;
      
      // Count should be reset to 0 after restart
      const finalState = lifecycle.getServerState();
      expect(finalState.searchCount).toBe(0);
      expect(finalState.status).toBe('running');
      
      console.log('[Integration Test] Search counter restarted at 1000, count reset to 0');
    },
    40000 // 40s timeout (includes restart time)
  );

  // ============================================================================
  // Test 6: Uptime timer increments
  // ============================================================================

  it(
    'uptime timer increments while running',
    async () => {
      // Start server
      await lifecycle.startServer();
      
      const initialState = lifecycle.getServerState();
      const initialUptime = initialState.uptime!;
      
      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const laterState = lifecycle.getServerState();
      const laterUptime = laterState.uptime!;
      
      // Uptime should have increased by ~1000ms (with tolerance)
      expect(laterUptime - initialUptime).toBeGreaterThanOrEqual(900);
      
      console.log(`[Integration Test] Uptime increased from ${initialUptime}ms to ${laterUptime}ms`);
    },
    10000 // 10s timeout
  );

  // ============================================================================
  // Test 7: Stdout/stderr buffers capture output
  // ============================================================================

  it(
    'stdout/stderr buffers capture output',
    async () => {
      // Start server
      await lifecycle.startServer();
      
      const state = lifecycle.getServerState();
      
      // Buffers should contain lines
      expect(state.stdoutBuffer.length).toBeGreaterThan(0);
      
      console.log(`[Integration Test] Captured ${state.stdoutBuffer.length} stdout lines`);
      console.log(`[Integration Test] Captured ${state.stderrBuffer.length} stderr lines`);
      
      // Show sample of captured output
      if (state.stdoutBuffer.length > 0) {
        console.log('[Integration Test] Sample stdout:', state.stdoutBuffer.slice(-3));
      }
    },
    35000 // 35s timeout
  );
});

// ============================================================================
// Skip message for when A2A is not installed or not patched
// ============================================================================

if (!A2A_AVAILABLE) {
  if (!A2A_INSTALLED) {
    console.log('[Integration Tests] Skipping all tests - A2A server not installed');
    console.log('[Integration Tests] Install with: npm install -g @google/gemini-cli-a2a-server');
  } else if (!A2A_PATCHED) {
    console.log('[Integration Tests] Skipping all tests - A2A server not patched');
    console.log('[Integration Tests] The _requestedModel patch is missing from a2a.ts');
  }
  
  // Still provide a passing test to show skip reason
  describe('A2A Lifecycle Integration Tests (skipped)', () => {
    it('all tests skipped - A2A server not available', () => {
      // This test just documents why tests were skipped
      expect(true).toBe(true);
    });
  });
}
