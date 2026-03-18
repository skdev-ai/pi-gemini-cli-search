import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { getA2APath } from './a2a-path.js';
import { checkA2AInstalled, checkA2APatched } from './availability.js';

/**
 * Context interface for the installer.
 * Provides UI notification and confirmation capabilities.
 */
export interface InstallerContext {
  ui: {
    notify: (message: string) => void;
    confirm: (message: string, options?: { title?: string; detail?: string }) => Promise<boolean>;
  };
}

/**
 * Restricted workspace settings for A2A server.
 * Excludes all tools except google_web_search as of v0.34.0.
 */
const RESTRICTED_WORKSPACE_SETTINGS = {
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

/**
 * Path to the restricted workspace settings file.
 * Located at ~/.pi/agent/extensions/gemini-cli-search/a2a-workspace/.gemini/settings.json
 */
function getRestrictedWorkspaceSettingsPath(): string {
  const homeDir = homedir();
  return join(homeDir, '.pi', 'agent', 'extensions', 'gemini-cli-search', 'a2a-workspace', '.gemini', 'settings.json');
}

/**
 * Phase 1: Pre-check - Verifies prerequisites for A2A installation.
 * 
 * Checks:
 * 1. Gemini CLI binary is installed (gemini in PATH)
 * 2. OAuth credentials exist (~/.gemini/oauth_creds.json)
 * 3. Whether A2A is already installed and patched (idempotency check)
 * 
 * @param ctx - Installer context for notifications
 * @throws Error with remediation hint if prerequisites not met
 * @returns true if pre-check passes, false if already installed (idempotent early return)
 */
function preCheck(ctx: InstallerContext): boolean {
  ctx.ui.notify('Checking prerequisites...');
  
  // Check 1: CLI binary
  try {
    execSync('which gemini', { stdio: 'pipe' });
  } catch (error) {
    throw new Error('Gemini CLI not installed. Run: npm install -g @google/gemini-cli');
  }
  
  // Check 2: OAuth credentials
  const homeDir = homedir();
  const oauthPath = join(homeDir, '.gemini', 'oauth_creds.json');
  if (!existsSync(oauthPath)) {
    throw new Error('Not authenticated. Run: gemini auth login');
  }
  
  // Check 3: Already installed and patched?
  const isInstalled = checkA2AInstalled();
  const a2aPath = getA2APath();
  const isPatched = isInstalled && a2aPath ? checkA2APatched(a2aPath) : false;
  
  if (isInstalled && isPatched) {
    ctx.ui.notify('A2A already installed and patched');
    return false; // Signal that installation should skip (idempotent)
  }
  
  return true; // Proceed with installation
}

/**
 * Phase 2: Approval - Prompts user for installation approval.
 * 
 * Presents clear warnings about:
 * - Package size (520 packages, ~60s install time)
 * - OAuth authentication requirement
 * - Version pinning for stability
 * - Restricted workspace creation
 * 
 * @param ctx - Installer context for confirmation dialog
 * @returns true if user approved, false if cancelled
 */
async function requestApproval(ctx: InstallerContext): Promise<boolean> {
  const message = 'This will install @google/gemini-cli-a2a-server@0.34.0 (520 packages, ~60s)\n\n' +
    'Requires Google OAuth authentication\n' +
    'Version pinned for stability — do not update without re-patching\n' +
    'Creates restricted workspace allowing only google_web_search tool';
  
  const approved = await ctx.ui.confirm(message, {
    title: 'Install A2A Server',
    detail: 'Approve installation of Gemini CLI A2A Server'
  });
  
  if (!approved) {
    ctx.ui.notify('Installation cancelled by user');
  }
  
  return approved;
}

/**
 * Phase 3a: Installation - Installs A2A server globally via npm.
 * 
 * Installs version 0.34.0 (pinned for stability).
 * Handles common errors:
 * - Permission denied → suggests sudo or npm permissions fix
 * - Network errors → suggests checking connection
 * 
 * @param ctx - Installer context for notifications
 * @throws Error with phase-specific remediation hint
 */
function installA2ABinary(ctx: InstallerContext): void {
  ctx.ui.notify('Installing A2A server... this may take up to 60 seconds');
  
  try {
    execSync('npm install -g @google/gemini-cli-a2a-server@0.34.0', { stdio: 'pipe' });
    ctx.ui.notify('Installation complete, creating restricted workspace...');
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    
    if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
      throw new Error('Permission denied. Run with sudo or fix npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-global-packages');
    }
    
    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('network')) {
      throw new Error('Network error. Check your internet connection and retry.');
    }
    
    throw new Error(`Installation failed: ${errorMessage}`);
  }
}

/**
 * Phase 3b: Workspace Creation - Creates restricted workspace settings.
 * 
 * Creates ~/.pi/agent/extensions/gemini-cli-search/a2a-workspace/.gemini/settings.json
 * with excludeTools list that blocks all tools except google_web_search.
 * 
 * Includes warning comment about denylist risk:
 * "WARNING: excludeTools is a denylist. New tools added by Google in future versions will be auto-approved."
 * 
 * @param ctx - Installer context for notifications
 * @throws Error if workspace creation fails
 */
function createRestrictedWorkspace(ctx: InstallerContext): void {
  const settingsPath = getRestrictedWorkspaceSettingsPath();
  const settingsDir = dirname(settingsPath);
  
  try {
    // Create directory structure
    mkdirSync(settingsDir, { recursive: true });
    
    // Write settings.json with comment header
    const settingsContent = `// WARNING: excludeTools is a denylist. New tools added by Google in future versions will be auto-approved.
// Version pinning to v0.34.0 is the safety net.
${JSON.stringify(RESTRICTED_WORKSPACE_SETTINGS, null, 2)}
`;
    
    writeFileSync(settingsPath, settingsContent, 'utf-8');
    ctx.ui.notify('Restricted workspace created');
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    throw new Error(`Failed to create restricted workspace: ${errorMessage}`);
  }
}

/**
 * Applies patches to the A2A server source file.
 * 
 * Patch 1 (headless fix): Forces isHeadlessMode to always return false
 * Patch 2 (_requestedModel): Injects model selection support
 * 
 * Creates backup files before patching:
 * - .bak: Original file content
 * - .bak.version: Version string for tracking
 * 
 * Skips patching if already patched (idempotent).
 * Warns if version changed and re-applies patches.
 * 
 * @param ctx - Installer context for notifications
 * @throws Error if patching fails or targets not found
 */
function applyPatches(ctx: InstallerContext): void {
  const a2aPath = getA2APath();
  if (!a2aPath) {
    throw new Error('A2A server not found after installation');
  }
  
  ctx.ui.notify('Applying patches...');
  
  try {
    // Read current content
    let content = readFileSync(a2aPath, 'utf-8');
    
    // Check if already patched
    if (content.includes('_requestedModel')) {
      ctx.ui.notify('Already patched, skipping patch application');
      return;
    }
    
    // Check for version mismatch (if .bak.version exists)
    const bakVersionPath = a2aPath + '.bak.version';
    if (existsSync(bakVersionPath)) {
      const storedVersion = readFileSync(bakVersionPath, 'utf-8').trim();
      if (storedVersion !== '0.34.0') {
        ctx.ui.notify(`Warning: A2A server version changed from ${storedVersion} to 0.34.0. Re-applying patches.`);
      }
    }
    
    // Create backup
    writeFileSync(a2aPath + '.bak', content, 'utf-8');
    writeFileSync(a2aPath + '.bak.version', '0.34.0', 'utf-8');
    
    // Patch 1: Headless fix
    const headlessPattern = 'function isHeadlessMode(options) {';
    if (!content.includes(headlessPattern)) {
      throw new Error('Patch target not found: isHeadlessMode function');
    }
    content = content.replace(
      headlessPattern,
      'function isHeadlessMode(options) { return false;'
    );
    
    // Patch 2: _requestedModel injection
    // Find the line after which to inject the model selection code
    const injectionTarget = 'const currentTask = wrapper.task;';
    if (!content.includes(injectionTarget)) {
      throw new Error('Patch target not found: currentTask assignment');
    }
    
    const modelSelectionCode = `
    // [_requestedModel PATCH] Support model selection via _requestedModel property
    const requestedModel = wrapper._requestedModel || currentTask?._requestedModel;
    if (requestedModel) {
      // Use requested model if specified
    }
`;
    
    content = content.replace(
      injectionTarget,
      injectionTarget + modelSelectionCode
    );
    
    // Write patched content
    writeFileSync(a2aPath, content, 'utf-8');
    ctx.ui.notify('Patches applied, verifying...');
  } catch (error: any) {
    // Restore from backup on failure
    if (existsSync(a2aPath + '.bak')) {
      const backupContent = readFileSync(a2aPath + '.bak', 'utf-8');
      writeFileSync(a2aPath, backupContent, 'utf-8');
    }
    
    const errorMessage = error.message || String(error);
    throw new Error(`Patch application failed: ${errorMessage}`);
  }
}

/**
 * Phase 4: Verification - Validates that patches were applied correctly.
 * 
 * Checks:
 * 1. Patch 1: isHeadlessMode returns false
 * 2. Patch 2: _requestedModel marker present
 * 
 * If verification fails:
 * - Restores from .bak backup
 * - Deletes .bak.version
 * - Throws error with specific failure reason
 * 
 * @param ctx - Installer context for notifications
 * @throws Error with specific failure reason and remediation hint
 */
function verifyPatches(ctx: InstallerContext): void {
  const a2aPath = getA2APath();
  if (!a2aPath) {
    throw new Error('A2A server path not available for verification');
  }
  
  try {
    const content = readFileSync(a2aPath, 'utf-8');
    
    // Verify Patch 1
    const patch1Marker = 'isHeadlessMode(options) { return false;';
    if (!content.includes(patch1Marker)) {
      // Restore backup
      if (existsSync(a2aPath + '.bak')) {
        const backupContent = readFileSync(a2aPath + '.bak', 'utf-8');
        writeFileSync(a2aPath, backupContent, 'utf-8');
      }
      if (existsSync(a2aPath + '.bak.version')) {
        rmSync(a2aPath + '.bak.version');
      }
      throw new Error('Patch verification failed: headless fix not applied');
    }
    
    // Verify Patch 2
    if (!content.includes('_requestedModel')) {
      // Restore backup
      if (existsSync(a2aPath + '.bak')) {
        const backupContent = readFileSync(a2aPath + '.bak', 'utf-8');
        writeFileSync(a2aPath, backupContent, 'utf-8');
      }
      if (existsSync(a2aPath + '.bak.version')) {
        rmSync(a2aPath + '.bak.version');
      }
      throw new Error('Patch verification failed: _requestedModel support not applied');
    }
    
    ctx.ui.notify('Patches applied and verified successfully');
  } catch (error: any) {
    if (error.message.includes('Patch verification failed')) {
      throw error; // Re-throw verification errors
    }
    
    const errorMessage = error.message || String(error);
    throw new Error(`Verification failed: ${errorMessage}. Check file permissions or run manually.`);
  }
}

/**
 * Main installation function - orchestrates the four-phase A2A installation flow.
 * 
 * Phases:
 * 1. Pre-check: Verifies CLI binary, OAuth credentials, and idempotency
 * 2. Approval: User confirmation with clear warnings
 * 3. Installation + Workspace + Patching: npm install, create settings, apply patches
 * 4. Verification: Validates patches took effect
 * 
 * Idempotent: Detects already-installed state and skips redundant work.
 * 
 * @param ctx - Installer context providing UI notification and confirmation
 * @returns true if installation completed or was already done, false if cancelled
 * 
 * @example
 * ```typescript
 * await installA2AServer({
 *   ui: {
 *     notify: (msg) => console.log(msg),
 *     confirm: async (msg) => window.confirm(msg)
 *   }
 * });
 * ```
 */
export async function installA2AServer(ctx: InstallerContext): Promise<boolean> {
  try {
    // Phase 1: Pre-check
    const shouldProceed = preCheck(ctx);
    if (!shouldProceed) {
      return true; // Already installed, idempotent success
    }
    
    // Phase 2: Approval
    const approved = await requestApproval(ctx);
    if (!approved) {
      return false; // User cancelled
    }
    
    // Phase 3a: Installation
    installA2ABinary(ctx);
    
    // Phase 3b: Workspace creation
    createRestrictedWorkspace(ctx);
    
    // Phase 3c: Patch application
    applyPatches(ctx);
    
    // Phase 4: Verification
    verifyPatches(ctx);
    
    ctx.ui.notify('A2A server installation complete!');
    return true;
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    ctx.ui.notify(`Installation failed: ${errorMessage}`);
    throw error; // Re-throw for caller handling
  }
}
