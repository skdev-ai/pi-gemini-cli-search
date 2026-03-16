# T02: Implement URL Resolver

## Description

Implement `resolveGroundingUrls(urls: string[]): Promise<string[]>` that resolves opaque Google redirect URLs to actual source domains using HEAD requests with graceful fallback.

## Steps

1. Create `src/url-resolver.ts` with the following implementation:
   - Export `resolveGroundingUrls(urls: string[]): Promise<GroundingUrl[]>`
   - For each URL, perform `fetch(url, { method: 'HEAD', redirect: 'manual' })`
   - Extract `Location` header from 302 responses
   - On failure (network error, non-302), use URL as-is with `resolvedSuccessfully: false`
   - Return array of `GroundingUrl` objects

2. Create `src/url-resolver.test.ts` with tests:
   - Mock fetch to return 302 with Location header → verify resolution
   - Mock fetch to return 200 (no redirect) → verify fallback
   - Mock fetch to throw network error → verify fallback
   - Test with mixed array (some resolve, some fail) → verify partial success handled

3. Verify all tests pass

## Must-Haves

- Function signature: `export async function resolveGroundingUrls(urls: string[]): Promise<GroundingUrl[]>`
- Uses native `fetch()` with `{ method: 'HEAD', redirect: 'manual' }`
- Extracts `Location` header from response
- Falls back gracefully on any failure (network error, non-302, timeout)
- Returns `GroundingUrl[]` with `original`, `resolved`, `resolvedSuccessfully` fields
- Handles concurrent requests (Promise.all)
- No external dependencies (native fetch only)

## Verification

- `npx tsc --noEmit` — No TypeScript errors
- `npm test -- url-resolver.test.ts` — All URL resolver tests pass
- Tests cover: successful redirect, non-302 response, network error, mixed results

## Inputs

- `src/types.ts` — GroundingUrl type definition

## Expected Output

- `src/url-resolver.ts` — 40-50 lines, pure function with no external dependencies
- `src/url-resolver.test.ts` — 60-80 lines, comprehensive test coverage
- All tests pass

## Observability Impact

None - function returns structured results, no logging or external state.
