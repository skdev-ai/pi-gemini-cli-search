# T01: In-Session Query Cache — Plan

**Description:** Implement in-session query cache to prevent redundant identical queries within a session. Cache keyed by normalized query (lowercase, trimmed), cleared on `session_start` event.

## Must-Haves

- `get(query: string): SearchResult | undefined` — returns cached result or undefined
- `set(query: string, result: SearchResult): void` — stores result with normalized key
- `clear(): void` — clears all cached entries
- `size(): number` — returns current cache size (for diagnostics)
- Query normalization: `query.toLowerCase().trim()` only (do NOT sort words)
- Cache includes errors and warnings (cache the full `SearchResult`)
- Session reset on `pi.on('session_start', () => cache.clear())`

## Files

- `src/cache.ts` (new)
- `src/cache.test.ts` (new)
- `src/types.ts` (modify — export `SearchResult` type for cache)
- `src/index.ts` (modify — register session reset listener, integrate cache lookup)

## Steps

1. **Create `src/cache.ts`:**
   - Import `SearchResult` from `./types`
   - Create private `Map<string, SearchResult>` for storage
   - Implement `normalizeQuery(query: string): string` — lowercase and trim
   - Implement `get(query: string): SearchResult | undefined`
   - Implement `set(query: string, result: SearchResult): void`
   - Implement `clear(): void`
   - Implement `size(): number`
   - Export all functions

2. **Create `src/cache.test.ts`:**
   - Test `get()` returns undefined for missing keys
   - Test `set()` and `get()` round-trip with exact query
   - Test normalization: "TypeScript" and "typescript" return same cached result
   - Test normalization: "  query  " (with spaces) trims correctly
   - Test `clear()` removes all entries
   - Test `size()` returns correct count
   - Test caching errors: set result with `error` field, verify it's returned
   - Test caching warnings: set result with `warning` field, verify it's returned

3. **Update `src/index.ts`:**
   - Import cache functions from `./cache`
   - Register `pi.on('session_start', () => cache.clear())` after tool registration
   - In execute handler, add cache lookup as first step:
     ```typescript
     const cached = cache.get(params.query);
     if (cached) {
       console.log('[gemini-cli-search] Cache hit for query:', params.query);
       return cached;
     }
     ```
   - After successful search, cache the result: `cache.set(params.query, result)`

## Verification

- `npx tsc --noEmit` — 0 TypeScript errors
- `npm test -- cache.test.ts` — 8 tests pass
- Manual integration test:
  1. Run query "what is TypeScript"
  2. Run same query again — should return instantly (check timing)
  3. Verify console shows "Cache hit for query: what is typescript"

## Inputs

- S01 implementation: `src/types.ts` with `SearchResult` interface
- S01 implementation: `src/index.ts` with tool registration
- pi extension API: `pi.on('session_start', handler)` event

## Expected Output

- `src/cache.ts` — ~50 lines, 5 exported functions
- `src/cache.test.ts` — ~100 lines, 8 passing tests
- Updated `src/index.ts` — cache integration with session reset
- Console log on cache hit: `[gemini-cli-search] Cache hit for query: ...`

## Observability Impact

- **New signal:** Console log on cache hit — useful for debugging redundant queries
- **Diagnostic:** `cache.size()` exposed for potential future debugging tools
- **Failure visibility:** Cache errors (if any) logged but don't block search execution
