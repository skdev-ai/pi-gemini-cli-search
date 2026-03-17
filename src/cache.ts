/**
 * In-session query cache for gemini-cli-search extension.
 * Caches search results keyed by normalized query (lowercase, trimmed).
 * Cleared on session_start event to prevent stale data across sessions.
 */

import type { SearchResult } from './types.js';

/**
 * Private storage for cached search results.
 * Key is normalized query, value is the full SearchResult.
 */
const cacheStore = new Map<string, SearchResult>();

/**
 * Normalizes a query string for cache key generation.
 * Applies lowercase and trim operations only.
 */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim();
}

/**
 * Retrieves a cached search result by query.
 * Returns undefined if no cached result exists.
 */
export function get(query: string): SearchResult | undefined {
  const key = normalizeQuery(query);
  return cacheStore.get(key);
}

/**
 * Stores a search result in the cache.
 * Caches both successful results and errors/warnings.
 */
export function set(query: string, result: SearchResult): void {
  const key = normalizeQuery(query);
  cacheStore.set(key, result);
}

/**
 * Clears all cached entries.
 * Called on session_start to prevent stale data.
 */
export function clear(): void {
  cacheStore.clear();
}

/**
 * Returns the current number of cached entries.
 * Useful for diagnostics and debugging.
 */
export function size(): number {
  return cacheStore.size;
}
