/**
 * Tests for in-session query cache.
 * Covers get/set operations, query normalization, and cache management.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { get, set, clear, size, normalizeQuery } from './cache.js';
import type { SearchResult } from './types.js';

describe('Query Cache', () => {
  beforeEach(() => {
    clear();
  });

  describe('get()', () => {
    it('returns undefined for missing keys', () => {
      const result = get('non-existent query');
      assert.strictEqual(result, undefined);
    });
  });

  describe('set() and get() round-trip', () => {
    it('returns cached result for exact query', () => {
      const expectedResult: SearchResult = {
        answer: 'Test answer',
        sources: [
          {
            title: 'Example',
            original: 'https://example.com',
            resolved: 'https://example.com',
            resolvedSuccessfully: true,
          },
        ],
      };

      set('Test Query', expectedResult);
      const result = get('Test Query');

      assert.deepStrictEqual(result, expectedResult);
    });
  });

  describe('Query normalization', () => {
    it('treats "TypeScript" and "typescript" as the same key', () => {
      const result: SearchResult = {
        answer: 'TypeScript is a typed superset of JavaScript',
        sources: [],
      };

      set('TypeScript', result);
      const lowercaseResult = get('typescript');

      assert.deepStrictEqual(lowercaseResult, result);
    });

    it('trims whitespace from queries', () => {
      const result: SearchResult = {
        answer: 'Trimmed query result',
        sources: [],
      };

      set('  query  ', result);
      const trimmedResult = get('query');

      assert.deepStrictEqual(trimmedResult, result);
    });

    it('handles combined case and whitespace normalization', () => {
      const result: SearchResult = {
        answer: 'Normalized result',
        sources: [],
      };

      set('  TypeScript  ', result);
      const normalizedResult = get('  typescript  ');

      assert.deepStrictEqual(normalizedResult, result);
    });
  });

  describe('clear()', () => {
    it('removes all cached entries', () => {
      set('query1', { answer: 'Answer 1', sources: [] });
      set('query2', { answer: 'Answer 2', sources: [] });

      assert.strictEqual(size(), 2);

      clear();

      assert.strictEqual(size(), 0);
      assert.strictEqual(get('query1'), undefined);
      assert.strictEqual(get('query2'), undefined);
    });
  });

  describe('size()', () => {
    it('returns correct count of cached entries', () => {
      assert.strictEqual(size(), 0);

      set('query1', { answer: 'Answer 1', sources: [] });
      assert.strictEqual(size(), 1);

      set('query2', { answer: 'Answer 2', sources: [] });
      assert.strictEqual(size(), 2);

      // Duplicate key should not increase size
      set('query1', { answer: 'Updated Answer 1', sources: [] });
      assert.strictEqual(size(), 2);

      clear();
      assert.strictEqual(size(), 0);
    });
  });

  describe('Caching errors', () => {
    it('caches results with error field', () => {
      const errorResult: SearchResult = {
        answer: '',
        sources: [],
        error: {
          type: 'CLI_NOT_FOUND',
          message: 'Gemini CLI not found',
        },
      };

      set('failing query', errorResult);
      const cachedResult = get('failing query');

      assert.deepStrictEqual(cachedResult, errorResult);
      assert.strictEqual(cachedResult?.error?.type, 'CLI_NOT_FOUND');
      assert.strictEqual(cachedResult?.error?.message, 'Gemini CLI not found');
    });
  });

  describe('Caching warnings', () => {
    it('caches results with warning field', () => {
      const warningResult: SearchResult = {
        answer: 'Answer from memory',
        sources: [],
        warning: {
          type: 'NO_SEARCH',
          message: 'Gemini answered from memory without searching',
        },
      };

      set('memory query', warningResult);
      const cachedResult = get('memory query');

      assert.deepStrictEqual(cachedResult, warningResult);
      assert.strictEqual(cachedResult?.warning?.type, 'NO_SEARCH');
      assert.strictEqual(cachedResult?.warning?.message, 'Gemini answered from memory without searching');
    });
  });
});

describe('normalizeQuery', () => {
  it('lowercases the query', () => {
    assert.strictEqual(normalizeQuery('TypeScript'), 'typescript');
    assert.strictEqual(normalizeQuery('HELLO'), 'hello');
  });

  it('trims whitespace from the query', () => {
    assert.strictEqual(normalizeQuery('  hello  '), 'hello');
    assert.strictEqual(normalizeQuery('\tquery\n'), 'query');
  });

  it('handles empty strings', () => {
    assert.strictEqual(normalizeQuery(''), '');
    assert.strictEqual(normalizeQuery('   '), '');
  });
});
