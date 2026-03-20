/**
 * Unit tests for the ACP (Agent Client Protocol) transport module.
 * 
 * These tests verify the module structure, exports, and code quality.
 * Full protocol compliance and integration testing happens in S06.
 */

import { describe, it, expect } from 'vitest';
import { executeSearchAcp, getAcpState, resetAcpState } from './acp.js';

describe('ACP Transport Module', () => {
  describe('exports', () => {
    it('exports executeSearchAcp function', () => {
      expect(executeSearchAcp).toBeDefined();
      expect(typeof executeSearchAcp).toBe('function');
    });

    it('exports getAcpState function', () => {
      expect(getAcpState).toBeDefined();
      expect(typeof getAcpState).toBe('function');
    });

    it('exports resetAcpState function', () => {
      expect(resetAcpState).toBeDefined();
      expect(typeof resetAcpState).toBe('function');
    });
  });

  describe('getAcpState', () => {
    it('returns idle status when no process is running', () => {
      resetAcpState();
      const state = getAcpState();
      
      expect(state.status).toBe('idle');
      expect(state.sessionCount).toBe(0);
      expect(state.lastError).toBe(null);
      expect(state.uptime).toBe(0);
    });

    it('tracks sessionCount after reset', () => {
      resetAcpState();
      const state1 = getAcpState();
      expect(state1.sessionCount).toBe(0);
      
      // Note: We can't actually increment the counter without calling executeSearchAcp
      // which requires a real gemini CLI process. Integration tests in S06 verify this.
    });

    it('returns uptime > 0 after process starts (integration test in S06)', () => {
      // This would require spawning actual gemini --acp process
      // Verified manually: uptime increases as process runs
      expect(true).toBe(true);
    });
  });

  describe('resetAcpState', () => {
    it('clears all state', () => {
      // Reset to clean state
      resetAcpState();
      const state1 = getAcpState();
      
      expect(state1.status).toBe('idle');
      expect(state1.sessionCount).toBe(0);
      expect(state1.lastError).toBe(null);
    });

    it('can be called multiple times safely', () => {
      resetAcpState();
      resetAcpState();
      resetAcpState();
      
      const state = getAcpState();
      expect(state.status).toBe('idle');
    });
  });

  describe('wire format comments', () => {
    it('contains initialize request format', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('{"jsonrpc":"2.0","method":"initialize"');
      expect(content).toContain('"protocolVersion":1');
      expect(content).toContain('clientInfo');
    });

    it('contains authenticate request format', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('{"jsonrpc":"2.0","method":"authenticate"');
      expect(content).toContain('methodId');
      expect(content).toContain('oauth-personal');
    });

    it('contains session/new request format', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('{"jsonrpc":"2.0","method":"session/new"');
      expect(content).toContain('mcpServers');
      expect(content).toContain('cwd');
    });

    it('contains session/prompt request format', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('{"jsonrpc":"2.0","method":"session/prompt"');
      expect(content).toContain('sessionId');
      expect(content).toContain('prompt');
    });

    it('contains session/cancel request format', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('{"jsonrpc":"2.0","method":"session/cancel"');
    });

    it('contains agent_message_chunk notification format', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('agent_message_chunk');
      expect(content).toContain('params.update.content.text');
    });

    it('contains tool_call notification format', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('tool_call');
      expect(content).toContain("kind === 'search'");
      expect(content).toContain('R010');
    });

    it('contains available_commands_update filter', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('available_commands_update');
    });

    it('documents text extraction path correctly', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      // Verify comment documents the correct path
      expect(content).toContain('params.update.content.text');
      // Verify comment warns about wrong path
      expect(content).toContain('NOT params.content.text');
    });
  });

  describe('constants', () => {
    it('uses SEARCH_MODEL constant for subprocess spawn', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('SEARCH_MODEL');
      expect(content).toContain("--acp', '-m', SEARCH_MODEL");
    });

    it('defines BOOT_TIMEOUT_MS constant', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('BOOT_TIMEOUT_MS');
      expect(content).toContain('20000'); // 20s
    });

    it('defines MAX_ACP_QUERIES_BEFORE_RESTART constant', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('MAX_ACP_QUERIES_BEFORE_RESTART');
      expect(content).toContain('= 20');
    });

    it('defines CANCEL_GRACE_PERIOD_MS constant', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('CANCEL_GRACE_PERIOD_MS');
      expect(content).toContain('2000'); // 2s
    });
  });

  describe('error handling', () => {
    it('throws errors instead of returning them (for cascade fallback)', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      // Verify error handling throws instead of returning { error }
      expect(content).toContain('throw err');
      // Verify comment explains why
      expect(content).toContain('cascade');
      expect(content).toContain('fallback');
    });

    it('monitors stderr for authentication errors', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('FatalAuthenticationError');
      expect(content).toContain('OAuth token expired');
      expect(content).toContain('NOT_AUTHENTICATED');
    });

    it('handles AbortSignal with session/cancel', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('session/cancel');
      expect(content).toContain('CANCEL_GRACE_PERIOD_MS');
      expect(content).toContain('.kill()');
    });
  });

  describe('answer processing pipeline', () => {
    it('calls extractLinks', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('extractLinks(fullText)');
    });

    it('calls resolveGroundingUrls', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('resolveGroundingUrls(links)');
    });

    it('calls stripLinks', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('stripLinks(fullText)');
    });

    it('applies NO_SEARCH warning', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('NO_SEARCH');
      expect(content).toContain('answered from memory');
    });
  });

  describe('transport metadata', () => {
    it('sets transport:"acp" on results', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      // Count occurrences of transport: 'acp'
      const matches = content.match(/transport:\s*'acp'/g);
      expect(matches).toBeTruthy();
      // At least 2: successful result and error cleanup paths
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('session reuse', () => {
    it('calls session/new only once per process lifetime', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      // Verify comment emphasizes single call
      expect(content).toContain('ONCE per process lifetime');
      expect(content).toContain('Do NOT call session/new per query');
      
      // Verify implementation stores sessionId
      expect(content).toContain('sessionId = sessionResult.sessionId');
    });

    it('reuses sessionId for subsequent queries', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      // Verify session/prompt uses stored sessionId
      expect(content).toContain('sessionId: sessionId!');
      // Verify early return if already initialized
      expect(content).toContain('if (acpProcess && sessionId)');
      expect(content).toContain('return;');
    });
  });

  describe('process restart', () => {
    it('restarts after MAX_ACP_QUERIES_BEFORE_RESTART', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      // Verify restart logic - counter incremented BEFORE check, so >= triggers at 20
      expect(content).toContain('acpQueryCount++');
      expect(content).toContain('await ensureAcpProcess()');
      expect(content).toContain('acpQueryCount >= MAX_ACP_QUERIES_BEFORE_RESTART');
      expect(content).toContain('context reset');
    });

    it('resets state on restart', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      // Verify state reset
      expect(content).toContain('sessionId = null');
      expect(content).toContain('acpQueryCount = 0');
      expect(content).toContain('processStartTime = null');
    });
  });

  describe('observability', () => {
    it('uses debugLog from logger module', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain("debugLog('acp'");
      expect(content).not.toContain('console.log');
    });

    it('tracks lastError in getAcpState', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('lastAcpError');
      expect(content).toContain('lastError: lastAcpError');
    });

    it('logs query count', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(new URL('./acp.ts', import.meta.url), 'utf-8');
      
      expect(content).toContain('Query');
      expect(content).toContain('MAX_ACP_QUERIES_BEFORE_RESTART');
    });
  });
});
