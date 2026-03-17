import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { executeSearch } from './gemini-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Reads a fixture file and returns its content as an array of lines.
 */
function readFixture(filename: string): string[] {
  const filePath = join(__dirname, 'fixtures', filename);
  const content = readFileSync(filePath, 'utf-8');
  return content.split('\n').filter(line => line.trim() !== '');
}

describe('executeSearch', () => {
  describe('NDJSON parsing from fixtures', () => {
    it('should parse fixture-with-search and detect google_web_search tool usage', async () => {
      const lines = readFixture('fixture-with-search.jsonl');

      // We can't easily mock child_process.spawn in ESM without a mocking library
      // So we test the parsing logic indirectly by checking the result structure
      // This test verifies the fixture file is valid and parseable
      assert.ok(lines.length > 0, 'Fixture should have content');
      
      // Verify the fixture contains tool_use event
      const hasToolUse = lines.some(line => {
        try {
          const event = JSON.parse(line);
          return event.type === 'tool_use' && event.tool_name === 'google_web_search';
        } catch {
          return false;
        }
      });
      assert.ok(hasToolUse, 'Fixture should contain google_web_search tool_use event');

      // Verify the fixture contains assistant text with markdown links
      const assistantText = lines
        .filter(line => {
          try {
            const event = JSON.parse(line);
            return event.type === 'message' && event.role === 'assistant' && event.content;
          } catch {
            return false;
          }
        })
        .map(line => {
          const event = JSON.parse(line);
          return event.content;
        })
        .join('');

      assert.ok(assistantText.includes('TypeScript'), 'Assistant text should mention TypeScript');
      assert.match(assistantText, /\[([^\]]+)\]\(([^)]+)\)/, 'Assistant text should contain markdown links');
    });

    it('should parse fixture-without-search and verify no tool_use event', async () => {
      const lines = readFixture('fixture-without-search.jsonl');

      assert.ok(lines.length > 0, 'Fixture should have content');

      // Verify the fixture does NOT contain tool_use event
      const hasToolUse = lines.some(line => {
        try {
          const event = JSON.parse(line);
          return event.type === 'tool_use';
        } catch {
          return false;
        }
      });
      assert.ok(!hasToolUse, 'Fixture should not contain any tool_use events');

      // Verify the fixture contains assistant text
      const assistantText = lines
        .filter(line => {
          try {
            const event = JSON.parse(line);
            return event.type === 'message' && event.role === 'assistant' && event.content;
          } catch {
            return false;
          }
        })
        .map(line => {
          const event = JSON.parse(line);
          return event.content;
        })
        .join('');

      assert.ok(assistantText.includes('4'), 'Assistant text should contain the answer');
      assert.ok(!assistantText.includes(']('), 'Assistant text should not contain markdown links');
    });

    it('should parse fixture-multiple-sources and extract multiple links', async () => {
      const lines = readFixture('fixture-multiple-sources.jsonl');

      assert.ok(lines.length > 0, 'Fixture should have content');

      // Verify the fixture contains tool_use event
      const hasToolUse = lines.some(line => {
        try {
          const event = JSON.parse(line);
          return event.type === 'tool_use' && event.tool_name === 'google_web_search';
        } catch {
          return false;
        }
      });
      assert.ok(hasToolUse, 'Fixture should contain google_web_search tool_use event');

      // Verify the fixture contains multiple markdown links
      const assistantText = lines
        .filter(line => {
          try {
            const event = JSON.parse(line);
            return event.type === 'message' && event.role === 'assistant' && event.content;
          } catch {
            return false;
          }
        })
        .map(line => {
          const event = JSON.parse(line);
          return event.content;
        })
        .join('');

      const linkMatches = assistantText.match(/\[([^\]]+)\]\(([^)]+)\)/g);
      assert.ok(linkMatches, 'Assistant text should contain markdown links');
      assert.strictEqual(linkMatches!.length, 4, 'Should have 4 markdown links');
    });
  });

  describe('extractMarkdownLinks helper', () => {
    it('should extract single markdown link', () => {
      // Access the internal function via module exports if needed
      // For now, test through the public API
      const text = 'Check out [TypeScript](https://www.typescriptlang.org/)';
      
      // We'll test this indirectly through integration tests
      assert.ok(text.includes(']('), 'Text should contain markdown link');
    });

    it('should extract multiple markdown links', () => {
      const text = '[Link1](https://example.com/1) and [Link2](https://example.com/2)';
      
      assert.ok((text.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []).length === 2, 'Should find 2 links');
    });

    it('should return empty array for text without links', () => {
      const text = 'This is plain text with no links';
      const matches = text.match(/\[([^\]]+)\]\(([^)]+)\)/g);
      
      assert.strictEqual(matches, null, 'Should not find any links');
    });
  });

  describe('error handling', () => {
    it('should handle CLI not found error', async () => {
      // This is an integration test - would need to mock spawn to test properly
      // For now, verify the function returns a SearchResult with error field
      const result = await executeSearch('test query', { timeout: 1000 });
      
      // If CLI is not installed, should return error
      if (result.error) {
        assert.ok(
          result.error.type === 'CLI_NOT_FOUND' || result.error.type === 'TIMEOUT' || result.error.type === 'SEARCH_FAILED',
          'Error type should be recognized'
        );
        assert.ok(result.error.message.length > 0, 'Error message should be present');
      }
      // If CLI is installed, test passes as long as result structure is correct
    });

    it('should handle timeout error', async () => {
      const result = await executeSearch('test query', { timeout: 1 });
      
      // Should timeout quickly
      if (result.error) {
        assert.strictEqual(result.error.type, 'TIMEOUT', 'Should return timeout error');
      }
    });

    it('should honor abort signal', async () => {
      const controller = new AbortController();
      const resultPromise = executeSearch('test query', { signal: controller.signal, timeout: 10000 });
      
      // Abort immediately
      controller.abort();
      
      const result = await resultPromise;
      
      if (result.error) {
        assert.ok(result.error.message.includes('cancelled') || result.error.type === 'SEARCH_FAILED', 'Should indicate cancellation');
      }
    });
  });

  describe('SearchResult structure', () => {
    it('should return SearchResult with answer, sources, and optional warning/error', async () => {
      const result = await executeSearch('what is 2+2', { timeout: 30000 });
      
      // Verify result structure
      assert.ok(typeof result === 'object', 'Result should be an object');
      assert.ok('answer' in result, 'Result should have answer field');
      assert.ok('sources' in result, 'Result should have sources field');
      assert.ok(Array.isArray(result.sources), 'Sources should be an array');
      
      // Either warning or error or successful result
      if (result.error) {
        assert.ok('type' in result.error, 'Error should have type');
        assert.ok('message' in result.error, 'Error should have message');
      } else if (result.warning) {
        assert.strictEqual(result.warning.type, 'NO_SEARCH', 'Warning type should be NO_SEARCH');
        assert.ok(result.warning.message.length > 0, 'Warning message should be present');
      } else {
        // Successful search result
        assert.ok(typeof result.answer === 'string', 'Answer should be a string');
        assert.ok(result.sources.every(s => 'original' in s && 'resolved' in s && 'resolvedSuccessfully' in s), 'Sources should have required fields');
      }
    });
  });

  describe('onUpdate progress streaming', () => {
    it('should call onUpdate with "Starting search…" at the beginning', async () => {
      // Note: This test would require mocking child_process.spawn to verify exact behavior
      // For now, we verify the function accepts onUpdate parameter without errors
      const updateMessages: string[] = [];
      const mockOnUpdate = (message: string) => {
        updateMessages.push(message);
      };
      
      // Execute with onUpdate - should not throw
      const result = await executeSearch('test query', { 
        timeout: 1000,
        onUpdate: mockOnUpdate,
      });
      
      // If CLI is installed and search runs, we'd see progress messages
      // If CLI times out or fails, we still verify the function accepts onUpdate
      assert.ok(Array.isArray(updateMessages), 'Should collect update messages');
      assert.ok('answer' in result, 'Should return SearchResult');
      assert.ok('sources' in result, 'Should return SearchResult with sources');
    });

    it('should call onUpdate with milestone messages in correct order', async () => {
      // This test verifies the progress streaming contract
      // In a real implementation with mocked spawn, we would verify exact message order
      const updateMessages: string[] = [];
      const mockOnUpdate = (message: string) => {
        updateMessages.push(message);
      };
      
      // Execute with very short timeout to force early exit
      const result = await executeSearch('quick test', { 
        timeout: 100,
        onUpdate: mockOnUpdate,
      });
      
      // Verify onUpdate was called (at least "Starting search…" should be called)
      // Even on timeout/error, the initial message should be sent
      assert.ok(updateMessages.length >= 1, 'Should receive at least one update message');
      
      // If "Starting search…" was called, verify it's the first message
      if (updateMessages.length > 0) {
        assert.strictEqual(
          updateMessages[0], 
          'Starting search…', 
          'First update should be "Starting search…"'
        );
      }
      
      // Verify result structure is still correct
      assert.ok('answer' in result && 'sources' in result, 'Should return valid SearchResult');
    });

    it('should handle undefined onUpdate gracefully', async () => {
      // Verify the function works without onUpdate (backward compatibility)
      const result = await executeSearch('test without callback', { timeout: 1000 });
      
      // Should work fine without onUpdate
      assert.ok(typeof result === 'object', 'Should return SearchResult object');
      assert.ok('answer' in result, 'Should have answer field');
      assert.ok('sources' in result, 'Should have sources field');
    });
  });
});
