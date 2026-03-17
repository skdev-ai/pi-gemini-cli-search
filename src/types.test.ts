/**
 * Type validation tests for shared types.
 * These tests validate the structure and exports of the types module.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import all types for validation
import type {
  SearchResult,
  GroundingUrl,
  SearchWarning,
  SearchError,
  SearchOptions,
} from './types.js';

describe('Shared Types', () => {
  describe('GroundingUrl', () => {
    it('should have required properties', () => {
      const url: GroundingUrl = {
        original: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/test',
        resolved: 'https://example.com/page',
        resolvedSuccessfully: true,
      };

      assert.strictEqual(typeof url.original, 'string');
      assert.strictEqual(typeof url.resolved, 'string');
      assert.strictEqual(typeof url.resolvedSuccessfully, 'boolean');
    });
  });

  describe('SearchWarning', () => {
    it('should have correct type discriminator', () => {
      const warning: SearchWarning = {
        type: 'NO_SEARCH',
        message: 'Gemini answered from memory without searching',
      };

      assert.strictEqual(warning.type, 'NO_SEARCH');
      assert.strictEqual(typeof warning.message, 'string');
    });
  });

  describe('SearchError', () => {
    it('should support all error types', () => {
      const errors: SearchError[] = [
        { type: 'CLI_NOT_FOUND', message: 'Gemini CLI not found' },
        { type: 'NOT_AUTHENTICATED', message: 'Not authenticated' },
        { type: 'TIMEOUT', message: 'Request timed out' },
        { type: 'PARSE_ERROR', message: 'Failed to parse response' },
        { type: 'SEARCH_FAILED', message: 'Search operation failed' },
      ];

      errors.forEach((err) => {
        assert.ok(
          [
            'CLI_NOT_FOUND',
            'NOT_AUTHENTICATED',
            'TIMEOUT',
            'PARSE_ERROR',
            'SEARCH_FAILED',
          ].includes(err.type)
        );
        assert.strictEqual(typeof err.message, 'string');
      });
    });
  });

  describe('SearchResult', () => {
    it('should have required and optional properties', () => {
      const result: SearchResult = {
        answer: 'The latest TypeScript version is 5.0.0',
        sources: [
          {
            original: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/test',
            resolved: 'https://www.typescriptlang.org/docs',
            resolvedSuccessfully: true,
          },
        ],
      };

      assert.strictEqual(typeof result.answer, 'string');
      assert.ok(Array.isArray(result.sources));
      assert.strictEqual(result.warning, undefined);
      assert.strictEqual(result.error, undefined);
    });

    it('should support warning property', () => {
      const result: SearchResult = {
        answer: 'Based on my training data...',
        sources: [],
        warning: {
          type: 'NO_SEARCH',
          message: 'Gemini answered from memory without searching',
        },
      };

      assert.strictEqual(result.warning?.type, 'NO_SEARCH');
    });

    it('should support error property', () => {
      const result: SearchResult = {
        answer: '',
        sources: [],
        error: {
          type: 'CLI_NOT_FOUND',
          message: 'Gemini CLI is not installed',
        },
      };

      assert.strictEqual(result.error?.type, 'CLI_NOT_FOUND');
    });
  });

  describe('SearchOptions', () => {
    it('should have all optional properties', () => {
      const options: SearchOptions = {};
      assert.strictEqual(options.model, undefined);
      assert.strictEqual(options.timeout, undefined);
      assert.strictEqual(options.signal, undefined);
    });

    it('should support partial options', () => {
      const options: SearchOptions = {
        model: 'gemini-2.5-pro',
        timeout: 30000,
      };

      assert.strictEqual(options.model, 'gemini-2.5-pro');
      assert.strictEqual(options.timeout, 30000);
    });

    it('should support all options', () => {
      const controller = new AbortController();
      const options: SearchOptions = {
        model: 'gemini-2.5-pro',
        timeout: 30000,
        signal: controller.signal,
      };

      assert.strictEqual(options.model, 'gemini-2.5-pro');
      assert.strictEqual(options.timeout, 30000);
      assert.ok(options.signal);
    });
  });
});
