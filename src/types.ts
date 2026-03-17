/**
 * Shared types for the gemini-cli-search extension.
 * These types define the contract for search results, URL resolution, and error handling.
 */

/**
 * Represents a resolved URL from Google grounding search.
 * The original URL is the opaque vertexaisearch redirect,
 * and resolved is the actual destination URL.
 */
export interface GroundingUrl {
  /** The original redirect URL (e.g., vertexaisearch.cloud.google.com/grounding-api-redirect/...) */
  original: string;
  /** The resolved actual URL after following the redirect */
  resolved: string;
  /** Whether the URL was successfully resolved */
  resolvedSuccessfully: boolean;
}

/**
 * Warning types for search results.
 * Used to indicate when Gemini answered from memory without searching.
 */
export interface SearchWarning {
  /** Warning type identifier */
  type: 'NO_SEARCH';
  /** Human-readable warning message */
  message: string;
}

/**
 * Structured error types for search operations.
 * Machine-distinguishable categories for error handling.
 */
export interface SearchError {
  /** Error type for programmatic handling */
  type:
    | 'CLI_NOT_FOUND'
    | 'NOT_AUTHENTICATED'
    | 'TIMEOUT'
    | 'PARSE_ERROR'
    | 'SEARCH_FAILED';
  /** Human-readable error message */
  message: string;
}

/**
 * Complete search result returned by the extension.
 * Contains either a successful result with answer and sources,
 * or error information if the search failed.
 */
export interface SearchResult {
  /** The AI-synthesized answer to the query */
  answer: string;
  /** List of source URLs used to ground the answer */
  sources: GroundingUrl[];
  /** Optional warning if Gemini answered from memory */
  warning?: SearchWarning;
  /** Optional error if the search failed */
  error?: SearchError;
}

/**
 * Configuration options for search operations.
 */
export interface SearchOptions {
  /** Optional model to use for the search */
  model?: string;
  /** Optional timeout in milliseconds */
  timeout?: number;
  /** Optional abort signal for cancellation */
  signal?: AbortSignal;
  /** Optional callback for progress updates during search */
  onUpdate?: (message: string) => void;
}
