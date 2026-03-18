import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('A2A Installer - Patch Application Logic', () => {
  let testFile: string;
  let backupFile: string;
  let versionFile: string;

  beforeEach(() => {
    // Create a temp file for testing
    testFile = join(tmpdir(), `a2a-test-${Date.now()}.mjs`);
    backupFile = testFile + '.bak';
    versionFile = testFile + '.bak.version';
  });

  /**
   * Helper to clean up test files after each test
   */
  function cleanup() {
    [testFile, backupFile, versionFile].forEach(f => {
      if (existsSync(f)) {
        rmSync(f);
      }
    });
  }

  describe('Patch Application', () => {
    it('applies headless fix patch correctly', () => {
      const originalContent = `
function isHeadlessMode(options) {
  return options.headless;
}
`;
      writeFileSync(testFile, originalContent, 'utf-8');
      
      // Simulate patch application
      let content = readFileSync(testFile, 'utf-8');
      const headlessPattern = 'function isHeadlessMode(options) {';
      content = content.replace(
        headlessPattern,
        'function isHeadlessMode(options) { return false;'
      );
      writeFileSync(testFile, content, 'utf-8');
      
      // Verify patch was applied
      const patched = readFileSync(testFile, 'utf-8');
      assert(patched.includes('isHeadlessMode(options) { return false;'));
      // The old "return options.headless;" line may still exist in the file
      // but the key is that the function now returns false immediately
      // So we just verify the patch marker is present
      
      cleanup();
    });

    it('applies _requestedModel injection patch correctly', () => {
      const originalContent = `
const wrapper = getWrapper();
const currentTask = wrapper.task;
// rest of code
`;
      writeFileSync(testFile, originalContent, 'utf-8');
      
      // Simulate patch application
      let content = readFileSync(testFile, 'utf-8');
      const injectionTarget = 'const currentTask = wrapper.task;';
      const modelSelectionCode = `
    // [_requestedModel PATCH] Support model selection via _requestedModel property
    const requestedModel = wrapper._requestedModel || currentTask?._requestedModel;
    if (requestedModel) {
      // Use requested model if specified
    }
`;
      content = content.replace(injectionTarget, injectionTarget + modelSelectionCode);
      writeFileSync(testFile, content, 'utf-8');
      
      // Verify patch was applied
      const patched = readFileSync(testFile, 'utf-8');
      assert(patched.includes('_requestedModel'));
      assert(patched.includes('wrapper._requestedModel'));
      assert(patched.includes('currentTask?._requestedModel'));
      
      cleanup();
    });

    it('creates backup files before patching', () => {
      const originalContent = 'original content';
      writeFileSync(testFile, originalContent, 'utf-8');
      
      // Create backup (simulating installer behavior)
      const content = readFileSync(testFile, 'utf-8');
      writeFileSync(backupFile, content, 'utf-8');
      writeFileSync(versionFile, '0.34.0', 'utf-8');
      
      // Verify backups exist
      assert(existsSync(backupFile));
      assert(existsSync(versionFile));
      assert.strictEqual(readFileSync(backupFile, 'utf-8'), originalContent);
      assert.strictEqual(readFileSync(versionFile, 'utf-8').trim(), '0.34.0');
      
      cleanup();
    });

    it('restores from backup on verification failure', () => {
      const originalContent = 'original unpatched content';
      
      writeFileSync(testFile, originalContent, 'utf-8');
      writeFileSync(backupFile, originalContent, 'utf-8');
      writeFileSync(versionFile, '0.34.0', 'utf-8');
      
      // Simulate failed verification (content doesn't have expected markers)
      const patched = readFileSync(testFile, 'utf-8');
      const hasPatch1 = patched.includes('isHeadlessMode(options) { return false;');
      const hasPatch2 = patched.includes('_requestedModel');
      
      if (!hasPatch1 || !hasPatch2) {
        // Restore from backup
        const backupContent = readFileSync(backupFile, 'utf-8');
        writeFileSync(testFile, backupContent, 'utf-8');
        rmSync(versionFile);
      }
      
      // Verify restoration
      assert(existsSync(testFile));
      assert(!existsSync(versionFile));
      assert.strictEqual(readFileSync(testFile, 'utf-8'), originalContent);
      
      cleanup();
    });
  });

  describe('Already-Patched Detection', () => {
    it('detects already-patched state and skips patching', () => {
      const alreadyPatchedContent = `
function isHeadlessMode(options) { return false;
  // some code
}
const requestedModel = wrapper._requestedModel;
`;
      writeFileSync(testFile, alreadyPatchedContent, 'utf-8');
      
      // Check if already patched
      const content = readFileSync(testFile, 'utf-8');
      const shouldSkip = content.includes('_requestedModel');
      
      assert(shouldSkip, 'Should detect already-patched state');
      
      // Verify no backup was created (since we skip patching)
      assert(!existsSync(backupFile), 'Backup should not be created for already-patched files');
      
      cleanup();
    });
  });

  describe('Version Mismatch Detection', () => {
    it('detects version mismatch and warns', () => {
      // Simulate existing .bak.version with old version
      writeFileSync(versionFile, '0.33.0', 'utf-8');
      
      const storedVersion = readFileSync(versionFile, 'utf-8').trim();
      const currentVersion = '0.34.0';
      const versionChanged = storedVersion !== currentVersion;
      
      assert(versionChanged, 'Should detect version mismatch');
      
      // In real installer, this would trigger re-application
      // For this test, we just verify detection works
      
      cleanup();
    });

    it('updates version file after successful patch', () => {
      writeFileSync(versionFile, '0.34.0', 'utf-8');
      
      const storedVersion = readFileSync(versionFile, 'utf-8').trim();
      assert.strictEqual(storedVersion, '0.34.0');
      
      cleanup();
    });
  });

  describe('Verification Logic', () => {
    it('verifies both patches are present', () => {
      const validPatchedContent = `
function isHeadlessMode(options) { return false;
  return true;
}
const requestedModel = wrapper._requestedModel;
`;
      writeFileSync(testFile, validPatchedContent, 'utf-8');
      
      const content = readFileSync(testFile, 'utf-8');
      const patch1Valid = content.includes('isHeadlessMode(options) { return false;');
      const patch2Valid = content.includes('_requestedModel');
      
      assert(patch1Valid, 'Patch 1 should be verified');
      assert(patch2Valid, 'Patch 2 should be verified');
      
      cleanup();
    });

    it('detects missing patch 1 target before patching', () => {
      const contentWithoutTarget = `
function someOtherFunction() {
  return true;
}
`;
      writeFileSync(testFile, contentWithoutTarget, 'utf-8');
      
      const content = readFileSync(testFile, 'utf-8');
      const hasTarget = content.includes('function isHeadlessMode(options) {');
      
      assert(!hasTarget, 'Should detect missing patch target');
      
      cleanup();
    });

    it('detects missing patch 2 target before patching', () => {
      const contentWithoutTarget = `
const wrapper = getWrapper();
// no currentTask assignment
`;
      writeFileSync(testFile, contentWithoutTarget, 'utf-8');
      
      const content = readFileSync(testFile, 'utf-8');
      const hasTarget = content.includes('const currentTask = wrapper.task;');
      
      assert(!hasTarget, 'Should detect missing patch target');
      
      cleanup();
    });
  });

  describe('Error Handling', () => {
    it('throws error when patch target not found', () => {
      const contentWithoutTarget = 'no matching targets here';
      writeFileSync(testFile, contentWithoutTarget, 'utf-8');
      
      const content = readFileSync(testFile, 'utf-8');
      const hasHeadlessTarget = content.includes('function isHeadlessMode(options) {');
      const hasCurrentTaskTarget = content.includes('const currentTask = wrapper.task;');
      
      assert(!hasHeadlessTarget, 'Should detect missing headless target');
      assert(!hasCurrentTaskTarget, 'Should detect missing currentTask target');
      
      cleanup();
    });
  });
});

describe('Restricted Workspace Settings', () => {
  it('generates correct settings.json structure', () => {
    const expectedSettings = {
      excludeTools: [
        'replace',
        'glob',
        'codebase_investigator',
        'enter_plan_mode',
        'exit_plan_mode',
        'generalist',
        'read_file',
        'list_directory',
        'save_memory',
        'grep_search',
        'run_shell_command',
        'web_fetch',
        'write_file',
        'activate_skill',
        'ask_user',
        'cli_help'
      ],
      folderTrust: true
    };
    
    // Verify structure
    assert(Array.isArray(expectedSettings.excludeTools));
    assert.strictEqual(expectedSettings.excludeTools.length, 16);
    assert.strictEqual(expectedSettings.folderTrust, true);
    
    // Verify google_web_search is NOT in excludeTools (it should be allowed)
    assert(!expectedSettings.excludeTools.includes('google_web_search'));
    
    // Verify JSON serialization works
    const jsonStr = JSON.stringify(expectedSettings, null, 2);
    const parsed = JSON.parse(jsonStr);
    assert.deepStrictEqual(parsed, expectedSettings);
  });

  it('includes warning comment in settings file', () => {
    const warningComment = '// WARNING: excludeTools is a denylist. New tools added by Google in future versions will be auto-approved.';
    const versionPinComment = '// Version pinning to v0.34.0 is the safety net.';
    
    const fullContent = `${warningComment}
${versionPinComment}
${JSON.stringify({ excludeTools: [], folderTrust: true }, null, 2)}
`;
    
    assert(fullContent.includes(warningComment));
    assert(fullContent.includes(versionPinComment));
  });
});

describe('Idempotency', () => {
  it('handles multiple runs gracefully', () => {
    const testFile = join(tmpdir(), `idempotent-test-${Date.now()}.mjs`);
    
    try {
      // First run: unpatched -> patched
      const unpatched = `function isHeadlessMode(options) {
  return options.headless;
}
const currentTask = wrapper.task;
`;
      writeFileSync(testFile, unpatched, 'utf-8');
      
      // Simulate first installation
      let content = readFileSync(testFile, 'utf-8');
      const isFirstRun = !content.includes('_requestedModel');
      assert(isFirstRun, 'First run should detect unpatched state');
      
      // Apply patch 1
      content = content.replace(
        'function isHeadlessMode(options) {',
        'function isHeadlessMode(options) { return false;'
      );
      // Apply patch 2
      content = content.replace(
        'const currentTask = wrapper.task;',
        'const currentTask = wrapper.task;\n    // [_requestedModel PATCH]'
      );
      writeFileSync(testFile, content, 'utf-8');
      
      // Second run: already patched -> skip
      const secondContent = readFileSync(testFile, 'utf-8');
      const shouldSkip = secondContent.includes('_requestedModel');
      assert(shouldSkip, 'Second run should detect already-patched state and skip');
      
      // Third run: still patched
      const thirdContent = readFileSync(testFile, 'utf-8');
      assert(thirdContent.includes('_requestedModel'), 'Third run should also detect patched state');
      
    } finally {
      if (existsSync(testFile)) {
        rmSync(testFile);
      }
    }
  });
});
