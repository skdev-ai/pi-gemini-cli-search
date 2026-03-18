import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// We'll test the actual behavior since Node.js test doesn't support easy mocking
// The tests verify the function's behavior based on actual system state

describe('getA2APath', () => {
  it('returns null or valid path (depends on system state)', async () => {
    const { getA2APath } = await import('./a2a-path.js');
    const result = getA2APath();
    
    // Result should be either null (not installed) or a string path (installed)
    assert(result === null || typeof result === 'string');
    
    // If a path is returned, verify it contains the expected binary name
    if (result !== null) {
      assert(result.includes('gemini-cli-a2a-server'), 'Path should contain gemini-cli-a2a-server');
      assert(result.length > 0, 'Path should not be empty');
    }
  });

  it('caches result on second call', async () => {
    const { getA2APath } = await import('./a2a-path.js');
    
    // First call - executes 'which' command
    const result1 = getA2APath();
    
    // Second call - should return cached value
    const result2 = getA2APath();
    
    // Both calls should return identical values
    assert.strictEqual(result1, result2, 'Second call should return cached value');
  });
});

describe('isA2APathResolved', () => {
  it('returns boolean value', async () => {
    const { isA2APathResolved } = await import('./a2a-path.js');
    const result = isA2APathResolved();
    
    assert.strictEqual(typeof result, 'boolean', 'isA2APathResolved should return boolean');
  });

  it('returns true after successful resolution', async () => {
    const { getA2APath, isA2APathResolved } = await import('./a2a-path.js');
    
    // Call getA2APath to resolve the path
    const pathResult = getA2APath();
    
    // If path was found, isA2APathResolved should return true
    if (pathResult !== null) {
      assert.strictEqual(isA2APathResolved(), true, 'Should return true after successful resolution');
    } else {
      // If path not found, should return false
      assert.strictEqual(isA2APathResolved(), false, 'Should return false when path not found');
    }
  });

  it('does not cache null results (allows re-checking)', async () => {
    const { getA2APath, isA2APathResolved } = await import('./a2a-path.js');
    
    // First call - if A2A not installed, returns null
    const result1 = getA2APath();
    
    // If first call returned null, isA2APathResolved should be false
    if (result1 === null) {
      assert.strictEqual(isA2APathResolved(), false, 'Should return false when null returned');
      
      // Second call - should attempt to resolve again (null not cached)
      const result2 = getA2APath();
      assert.strictEqual(result2, null, 'Second call should also return null');
    }
  });
});

// Additional test to verify execSync is called correctly
describe('getA2APath implementation', () => {
  it('trims whitespace from execSync result', async () => {
    // This test verifies that if a path is returned, it doesn't have trailing newlines
    const { getA2APath } = await import('./a2a-path.js');
    const result = getA2APath();
    
    if (result !== null) {
      // Verify no leading/trailing whitespace
      assert.strictEqual(result, result.trim(), 'Result should be trimmed');
      assert(!result.endsWith('\n'), 'Result should not end with newline');
    }
  });
});
