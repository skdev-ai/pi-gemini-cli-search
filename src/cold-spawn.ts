/**
 * Cold spawn adapter for gemini-cli-search.
 * 
 * This is a thin wrapper around the existing executeSearch() function
 * that adds transport:'cold' metadata to SearchResult objects.
 * 
 * Used as the lowest-risk tier in the unified search cascade (A2A→ACP→cold).
 */

import { executeSearch } from './gemini-cli.js';
import type { SearchResult, SearchOptions } from './types.js';
import { SEARCH_MODEL } from './types.js';
import { debugLog } from './logger.js';

/**
 * Executes a search query using the cold spawn transport.
 * 
 * This adapter wraps the existing executeSearch() function and:
 * - Uses SEARCH_MODEL constant as default model when not specified
 * - Adds transport:'cold' field to the returned SearchResult
 * - Forwards all options (signal, onUpdate, timeout, model) unchanged
 * 
 * @param query - The search query to execute
 * @param options - Optional search configuration
 * @returns Promise resolving to SearchResult with transport:'cold' set
 */
export async function executeSearchCold(
  query: string,
  options?: SearchOptions
): Promise<SearchResult> {
  debugLog('cold-spawn', `Cold spawn adapter called for query: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);
  
  // Call executeSearch with SEARCH_MODEL as default, preserving all other options
  const result = await executeSearch(query, {
    ...options,
    model: options?.model ?? SEARCH_MODEL,
  });

  debugLog('cold-spawn', `Cold spawn completed with ${result.sources.length} sources, transport:'cold'`);

  // Add transport metadata to the result
  return {
    ...result,
    transport: 'cold',
  };
}
