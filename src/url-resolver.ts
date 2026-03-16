import type { GroundingUrl } from './types.js';

/**
 * Resolves opaque Google redirect URLs to actual source domains using HEAD requests.
 * 
 * For each URL:
 * - Performs a HEAD request with redirect: 'manual' to catch 302 responses
 * - Extracts the Location header from 302 responses
 * - On any failure (network error, non-302, timeout), uses the URL as-is
 * 
 * @param urls - Array of URLs to resolve (may include opaque vertexaisearch.cloud.google.com redirects)
 * @returns Promise resolving to array of GroundingUrl objects with resolution status
 */
export async function resolveGroundingUrls(urls: string[]): Promise<GroundingUrl[]> {
  const results = await Promise.all(
    urls.map(async (url): Promise<GroundingUrl> => {
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          redirect: 'manual',
        });

        // Check if this is a 302 redirect with a Location header
        if (response.status === 302 || response.status === 301 || response.status === 307 || response.status === 308) {
          const location = response.headers.get('Location');
          if (location) {
            return {
              original: url,
              resolved: location,
              resolvedSuccessfully: true,
            };
          }
        }

        // Non-redirect response (200, 404, etc.) - use URL as-is
        return {
          original: url,
          resolved: url,
          resolvedSuccessfully: false,
        };
      } catch (_error) {
        // Network error, timeout, or any other failure - use URL as-is
        return {
          original: url,
          resolved: url,
          resolvedSuccessfully: false,
        };
      }
    })
  );

  return results;
}
