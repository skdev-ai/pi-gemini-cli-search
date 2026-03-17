import type { GroundingUrl } from './types.js';

/**
 * Resolves URLs to their final destinations using HEAD requests.
 *
 * For each link:
 * - If it's a grounding redirect (vertexaisearch.cloud.google.com), follows the redirect
 * - If it's already a direct URL, keeps it as-is (marked as resolved)
 * - On any failure, falls back to the original URL
 *
 * @param links - Array of { title, url } extracted from Gemini's response
 * @returns Promise resolving to array of GroundingUrl objects with resolution status
 */
export async function resolveGroundingUrls(
  links: Array<{ title: string; url: string }>
): Promise<GroundingUrl[]> {
  const results = await Promise.all(
    links.map(async ({ title, url }): Promise<GroundingUrl> => {
      // If it's not a grounding redirect, it's already a direct URL
      if (!url.includes('vertexaisearch.cloud.google.com/grounding-api-redirect/')) {
        return {
          title,
          original: url,
          resolved: url,
          resolvedSuccessfully: true,
        };
      }

      // Try to resolve the grounding redirect
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          redirect: 'manual',
        });

        if (response.status === 302 || response.status === 301 || response.status === 307 || response.status === 308) {
          const location = response.headers.get('Location');
          if (location) {
            return {
              title,
              original: url,
              resolved: location,
              resolvedSuccessfully: true,
            };
          }
        }

        // Non-redirect response — resolution failed
        return {
          title,
          original: url,
          resolved: url,
          resolvedSuccessfully: false,
        };
      } catch {
        // Network error — resolution failed
        return {
          title,
          original: url,
          resolved: url,
          resolvedSuccessfully: false,
        };
      }
    })
  );

  return results;
}
