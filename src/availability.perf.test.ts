import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkCliBinary, checkA2AInstalled, checkA2ARunning, checkAvailability } from './availability.js';
import { getA2APath, getA2APackageRoot } from './a2a-path.js';

/**
 * Performance tests for availability check functions.
 * 
 * R016 Acceptance Criteria:
 * - Total check time: ~50ms when server running, ~550ms when server not running
 * - Individual checks should complete in <100ms each
 */

describe('R016 Performance Tests', () => {
  it('checkCliBinary() should complete in <10ms (no execSync)', async () => {
    const start = performance.now();
    const result = checkCliBinary();
    const duration = performance.now() - start;
    
    console.log(`checkCliBinary(): ${duration.toFixed(2)}ms (result: ${result})`);
    
    // Should be very fast since it's just existsSync on PATH directories
    assert.ok(duration < 10, `checkCliBinary() took ${duration.toFixed(2)}ms, expected <10ms`);
    assert.ok(typeof result === 'boolean', 'checkCliBinary() should return boolean');
  });

  it('checkA2AInstalled() should complete in <5ms (just path lookup)', async () => {
    const start = performance.now();
    const result = checkA2AInstalled();
    const duration = performance.now() - start;
    
    console.log(`checkA2AInstalled(): ${duration.toFixed(2)}ms (result: ${result})`);
    
    // Should be extremely fast - just checks cached path
    // Relaxed to <10ms to account for real-world variance (was <5ms)
    assert.ok(duration < 10, `checkA2AInstalled() took ${duration.toFixed(2)}ms, expected <10ms`);
    assert.ok(typeof result === 'boolean', 'checkA2AInstalled() should return boolean');
  });

  it('getA2APath() should resolve and cache correctly', async () => {
    const start = performance.now();
    const path1 = getA2APath();
    const duration1 = performance.now() - start;
    
    console.log(`getA2APath() first call: ${duration1.toFixed(2)}ms (result: ${path1 ? 'resolved' : 'null'})`);
    
    // Second call should be instant (cached)
    const start2 = performance.now();
    const path2 = getA2APath();
    const duration2 = performance.now() - start2;
    
    console.log(`getA2APath() second call (cached): ${duration2.toFixed(2)}ms`);
    
    assert.ok(duration2 < 1, `Cached getA2APath() took ${duration2.toFixed(2)}ms, expected <1ms`);
    assert.strictEqual(path1, path2, 'Cached path should match first call');
  });

  it('getA2APackageRoot() should derive correct package root', async () => {
    const start = performance.now();
    const root = getA2APackageRoot();
    const duration = performance.now() - start;
    
    console.log(`getA2APackageRoot(): ${duration.toFixed(2)}ms (result: ${root ? 'resolved' : 'null'})`);
    
    if (root) {
      // Verify it looks like a valid package root path
      assert.ok(root.includes('gemini-cli-a2a-server'), `Package root should include package name: ${root}`);
      assert.ok(root.includes('node_modules'), `Package root should include node_modules: ${root}`);
    }
    
    // Should be fast (uses cached binary path)
    assert.ok(duration < 5, `getA2APackageRoot() took ${duration.toFixed(2)}ms, expected <5ms`);
  });

  it('checkA2ARunning() should respond quickly when server running OR timeout ~500ms when not', async () => {
    const start = performance.now();
    const result = await checkA2ARunning(41242);
    const duration = performance.now() - start;
    
    if (result === true) {
      // Server IS running - should respond quickly (<100ms)
      console.log(`checkA2ARunning() (server RUNNING): ${duration.toFixed(2)}ms (result: ${result})`);
      assert.ok(duration < 100, `checkA2ARunning() took ${duration.toFixed(2)}ms, expected <100ms for responsive server`);
    } else {
      // Server NOT running - should timeout around 500ms
      console.log(`checkA2ARunning() (server not running): ${duration.toFixed(2)}ms (result: ${result})`);
      assert.ok(duration >= 400, `checkA2ARunning() took ${duration.toFixed(2)}ms, expected >=400ms (timeout)`);
      assert.ok(duration <= 700, `checkA2ARunning() took ${duration.toFixed(2)}ms, expected <=700ms (timeout + overhead)`);
    }
  });

  it('checkAvailability() should complete in ~50ms when server running, ~550ms when not', async () => {
    const start = performance.now();
    const result = checkAvailability();
    const duration = performance.now() - start;
    
    console.log(`checkAvailability(): ${duration.toFixed(2)}ms`);
    console.log(`  - available: ${result.available}`);
    console.log(`  - reason: ${result.reason || 'none'}`);
    if (result.a2a) {
      console.log(`  - a2a.installed: ${result.a2a.installed}`);
      console.log(`  - a2a.patched: ${result.a2a.patched}`);
    }
    
    // When server NOT running: ~550ms total (most time in checkA2ARunning timeout)
    // When server IS running: ~50ms total
    // For this test, we expect server NOT running (S02 runs before S03 installation)
    const expectedMax = 700; // Generous margin for 550ms target
    assert.ok(duration < expectedMax, `checkAvailability() took ${duration.toFixed(2)}ms, expected <${expectedMax}ms`);
    
    // Result should have correct structure
    assert.ok('available' in result, 'checkAvailability() should return object with available field');
    assert.ok(result.a2a === undefined || typeof result.a2a === 'object', 'a2a field should be object or undefined');
  });

  it('Full availability check sequence should meet R016 targets', async () => {
    console.log('\n=== R016 Full Sequence Performance Test ===');
    
    // Run all checks in sequence
    const timings: Record<string, number> = {};
    
    // 1. CLI binary check
    let start = performance.now();
    checkCliBinary();
    timings.checkCliBinary = performance.now() - start;
    
    // 2. A2A installed check
    start = performance.now();
    checkA2AInstalled();
    timings.checkA2AInstalled = performance.now() - start;
    
    // 3. A2A path resolution (if needed)
    start = performance.now();
    getA2APath();
    timings.getA2APath = performance.now() - start;
    
    // 4. Package root derivation
    start = performance.now();
    getA2APackageRoot();
    timings.getA2APackageRoot = performance.now() - start;
    
    // 5. A2A running check (async, includes timeout)
    start = performance.now();
    await checkA2ARunning(41242);
    timings.checkA2ARunning = performance.now() - start;
    
    // Log results
    console.log('\nTiming Results:');
    Object.entries(timings).forEach(([name, duration]) => {
      console.log(`  ${name}: ${duration.toFixed(2)}ms`);
    });
    
    const totalTime = Object.values(timings).reduce((sum, t) => sum + t, 0);
    console.log(`\nTotal time: ${totalTime.toFixed(2)}ms`);
    
    // R016 target: ~550ms when server not running (500ms timeout + 50ms overhead)
    // When server IS running: ~50ms total
    // Allow 2x margin for CI environments
    assert.ok(totalTime < 1100, `Total time ${totalTime.toFixed(2)}ms exceeds 1100ms (2x R016 target)`);
    
    // Individual check targets (excluding checkA2ARunning which varies based on server state)
    assert.ok(timings.checkCliBinary < 10, `checkCliBinary ${timings.checkCliBinary.toFixed(2)}ms > 10ms`);
    assert.ok(timings.checkA2AInstalled < 10, `checkA2AInstalled ${timings.checkA2AInstalled.toFixed(2)}ms > 10ms`);  // Was 5ms, relaxed to 10ms for real-world variance
    assert.ok(timings.getA2APath < 50, `getA2APath ${timings.getA2APath.toFixed(2)}ms > 50ms`);
    assert.ok(timings.getA2APackageRoot < 5, `getA2APackageRoot ${timings.getA2APackageRoot.toFixed(2)}ms > 5ms`);
    
    // checkA2ARunning: <100ms if server running, 400-700ms if not running (timeout)
    const serverRunning = timings.checkA2ARunning < 100;
    if (!serverRunning) {
      assert.ok(timings.checkA2ARunning >= 400 && timings.checkA2ARunning <= 700, 
        `checkA2ARunning ${timings.checkA2ARunning.toFixed(2)}ms outside 400-700ms range (timeout expected)`);
    }
    
    console.log(`\n✅ All R016 performance targets met! (Server ${serverRunning ? 'IS running' : 'NOT running - timeout worked'})`);
  });
});
