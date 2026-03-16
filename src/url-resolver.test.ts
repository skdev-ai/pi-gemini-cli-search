/**
 * Tests for URL resolver functionality.
 * Tests the resolveGroundingUrls function with mocked fetch responses.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { resolveGroundingUrls } from './url-resolver.js';
import type { GroundingUrl } from './types.js';

describe('resolveGroundingUrls', () => {
  it('should resolve URL when fetch returns 302 with Location header', async () => {
    const mockLocation = 'https://example.com/actual-page';
    const mockResponse = {
      status: 302,
      headers: {
        get: (name: string) => name === 'Location' ? mockLocation : null,
      },
    };

    const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(mockResponse));

    const urls = ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/test'];
    const results = await resolveGroundingUrls(urls);

    assert.strictEqual(results.length, 1);
    const result = results[0] as GroundingUrl;
    assert.strictEqual(result.original, urls[0]);
    assert.strictEqual(result.resolved, mockLocation);
    assert.strictEqual(result.resolvedSuccessfully, true);

    fetchMock.mock.restore();
  });

  it('should handle 301 redirect with Location header', async () => {
    const mockLocation = 'https://example.com/permanent-redirect';
    const mockResponse = {
      status: 301,
      headers: {
        get: (name: string) => name === 'Location' ? mockLocation : null,
      },
    };

    const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(mockResponse));

    const results = await resolveGroundingUrls(['https://example.com/redirect']);
    const result = results[0] as GroundingUrl;

    assert.strictEqual(result.resolved, mockLocation);
    assert.strictEqual(result.resolvedSuccessfully, true);

    fetchMock.mock.restore();
  });

  it('should handle 307 temporary redirect with Location header', async () => {
    const mockLocation = 'https://example.com/temporary-redirect';
    const mockResponse = {
      status: 307,
      headers: {
        get: (name: string) => name === 'Location' ? mockLocation : null,
      },
    };

    const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(mockResponse));

    const results = await resolveGroundingUrls(['https://example.com/redirect']);
    const result = results[0] as GroundingUrl;

    assert.strictEqual(result.resolved, mockLocation);
    assert.strictEqual(result.resolvedSuccessfully, true);

    fetchMock.mock.restore();
  });

  it('should handle 308 permanent redirect with Location header', async () => {
    const mockLocation = 'https://example.com/permanent-temporary-redirect';
    const mockResponse = {
      status: 308,
      headers: {
        get: (name: string) => name === 'Location' ? mockLocation : null,
      },
    };

    const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(mockResponse));

    const results = await resolveGroundingUrls(['https://example.com/redirect']);
    const result = results[0] as GroundingUrl;

    assert.strictEqual(result.resolved, mockLocation);
    assert.strictEqual(result.resolvedSuccessfully, true);

    fetchMock.mock.restore();
  });

  it('should fallback to original URL when fetch returns 200 (no redirect)', async () => {
    const mockResponse = {
      status: 200,
      headers: {
        get: () => null,
      },
    };

    const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(mockResponse));

    const originalUrl = 'https://example.com/page';
    const results = await resolveGroundingUrls([originalUrl]);
    const result = results[0] as GroundingUrl;

    assert.strictEqual(result.original, originalUrl);
    assert.strictEqual(result.resolved, originalUrl);
    assert.strictEqual(result.resolvedSuccessfully, false);

    fetchMock.mock.restore();
  });

  it('should fallback to original URL when fetch returns 404', async () => {
    const mockResponse = {
      status: 404,
      headers: {
        get: () => null,
      },
    };

    const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(mockResponse));

    const originalUrl = 'https://example.com/not-found';
    const results = await resolveGroundingUrls([originalUrl]);
    const result = results[0] as GroundingUrl;

    assert.strictEqual(result.resolved, originalUrl);
    assert.strictEqual(result.resolvedSuccessfully, false);

    fetchMock.mock.restore();
  });

  it('should fallback to original URL when network error occurs', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', () => Promise.reject(new Error('Network error')));

    const originalUrl = 'https://example.com/network-error';
    const results = await resolveGroundingUrls([originalUrl]);
    const result = results[0] as GroundingUrl;

    assert.strictEqual(result.original, originalUrl);
    assert.strictEqual(result.resolved, originalUrl);
    assert.strictEqual(result.resolvedSuccessfully, false);

    fetchMock.mock.restore();
  });

  it('should fallback to original URL when fetch throws timeout error', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', () => Promise.reject(new Error('Timeout')));

    const originalUrl = 'https://example.com/timeout';
    const results = await resolveGroundingUrls([originalUrl]);
    const result = results[0] as GroundingUrl;

    assert.strictEqual(result.resolvedSuccessfully, false);
    assert.strictEqual(result.resolved, originalUrl);

    fetchMock.mock.restore();
  });

  it('should handle mixed array with some successful resolutions and some failures', async () => {
    let callCount = 0;
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      callCount++;
      if (callCount === 1) {
        // First URL succeeds with redirect
        return {
          status: 302,
          headers: {
            get: (name: string) => name === 'Location' ? 'https://resolved.com/page' : null,
          },
        };
      } else if (callCount === 2) {
        // Second URL fails with network error
        throw new Error('Network error');
      } else {
        // Third URL returns 200 (no redirect)
        return {
          status: 200,
          headers: {
            get: () => null,
          },
        };
      }
    });

    const urls = [
      'https://vertexaisearch.cloud.google.com/redirect1',
      'https://vertexaisearch.cloud.google.com/redirect2',
      'https://vertexaisearch.cloud.google.com/redirect3',
    ];

    const results = await resolveGroundingUrls(urls);

    assert.strictEqual(results.length, 3);

    // First URL resolved successfully
    assert.strictEqual(results[0]!.resolvedSuccessfully, true);
    assert.strictEqual(results[0]!.resolved, 'https://resolved.com/page');

    // Second URL failed (network error)
    assert.strictEqual(results[1]!.resolvedSuccessfully, false);
    assert.strictEqual(results[1]!.resolved, urls[1]);

    // Third URL failed (no redirect)
    assert.strictEqual(results[2]!.resolvedSuccessfully, false);
    assert.strictEqual(results[2]!.resolved, urls[2]);

    fetchMock.mock.restore();
  });

  it('should handle empty array', async () => {
    const results = await resolveGroundingUrls([]);
    assert.strictEqual(results.length, 0);
    assert.deepStrictEqual(results, []);
  });

  it('should handle 302 response without Location header', async () => {
    const mockResponse = {
      status: 302,
      headers: {
        get: () => null, // No Location header
      },
    };

    const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(mockResponse));

    const originalUrl = 'https://example.com/redirect-no-location';
    const results = await resolveGroundingUrls([originalUrl]);
    const result = results[0] as GroundingUrl;

    assert.strictEqual(result.resolved, originalUrl);
    assert.strictEqual(result.resolvedSuccessfully, false);

    fetchMock.mock.restore();
  });

  it('should handle concurrent requests (all URLs processed in parallel)', async () => {
    const callTimes: number[] = [];
    const startTime = Date.now();

    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      callTimes.push(Date.now() - startTime);
      return {
        status: 302,
        headers: {
          get: (name: string) => name === 'Location' ? 'https://example.com/resolved' : null,
        },
      };
    });

    const urls = [
      'https://example.com/url1',
      'https://example.com/url2',
      'https://example.com/url3',
    ];

    const results = await resolveGroundingUrls(urls);

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results.every(r => r.resolvedSuccessfully), true);

    // Verify all calls happened roughly at the same time (within 100ms of each other)
    // This confirms parallel execution rather than sequential
    const timeSpan = Math.max(...callTimes) - Math.min(...callTimes);
    assert.ok(timeSpan < 100, `Requests should be concurrent, but time span was ${timeSpan}ms`);

    fetchMock.mock.restore();
  });
});
