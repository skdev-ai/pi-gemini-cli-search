import { execSync } from 'node:child_process';

/**
 * Module-level cache for the A2A server path.
 * Only non-null results are cached to allow re-checking if user installs A2A mid-session.
 */
let cachedPath: string | null = null;

/**
 * Resolves and caches the A2A server path from `which gemini-cli-a2a-server`.
 * Returns null if the A2A server is not installed globally.
 * 
 * Uses execSync() with try-catch for synchronous error handling.
 * Only caches non-null results (allows re-checking after installation).
 * 
 * @returns The resolved path to gemini-cli-a2a-server, or null if not installed
 */
export function getA2APath(): string | null {
  // Return cached value if already resolved (only non-null values are cached)
  if (cachedPath !== null) {
    return cachedPath;
  }

  try {
    // Execute 'which gemini-cli-a2a-server' to find the binary path
    const result = execSync('which gemini-cli-a2a-server', { encoding: 'utf-8' });
    // Trim whitespace (execSync includes trailing newline)
    cachedPath = result.trim();
    return cachedPath;
  } catch (error) {
    // execSync throws on non-zero exit code (e.g., command not found)
    // Return null but don't cache it, allowing re-checking
    return null;
  }
}

/**
 * Checks if the A2A server path has been successfully resolved and cached.
 * Returns true only if getA2APath() was called and returned a non-null result.
 * 
 * @returns true if A2A path is cached, false otherwise
 */
export function isA2APathResolved(): boolean {
  return cachedPath !== null;
}
