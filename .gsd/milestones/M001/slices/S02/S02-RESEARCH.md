---
id: S02
parent: M001
milestone: M001
title: Operability & resilience
status: researching
---

# S02: Operability & Resilience — Research

**Date:** 2026-03-16

## Summary

S02 implements operability and resilience features for the Gemini CLI Search extension. Analysis of S01 deliverables reveals that **4 of 6 requirements are already partially or fully implemented**, leaving **2 major features** to build: in-session query caching (R004) and progress streaming via onUpdate (R006).

**Primary recommendation:** Implement caching first (new `src/cache.ts` module), then enhance `executeSearch()` to support progress streaming. The existing availability detection, cancellation, environment config, and error reporting from S01 are sufficient — they need documentation and minor refinements, not reimplementation.

## Recommendation

**Build in this order:**

1. **T01: In-session query cache** — New `src/cache.ts` with `get(query)` and `set(query, result)` functions. Cache keyed by normalized query (lowercase, trimmed). TTL = session duration (cleared on `session_start` event). This is the highest-value feature — prevents redundant identical queries within a session.

2. **T02: Progress streaming** — Wire `onUpdate` callback through execute handler → `executeSearch()`. Stream progress events: "Starting search…", "Parsing response…", "Resolving X source URLs…", "Complete". Requires updating `execute()` signature to match pi extension API spec.

3. **T03: Availability detection refinement** — Extract `checkAvailability()` into dedicated `src/availability.ts` module. Add `export function isAvailable(): { available: boolean; reason?: string }` for reuse. Current implementation is correct; this is refactoring for clarity.

4. **T04: Integration & documentation** — Update tool registration to use full execute signature, integrate cache and progress streaming, add tests for all new functionality. Verify caching prevents redundant subprocess execution.

**Why this order:** Caching is independent and highest-value. Progress streaming depends on cache being in place (cache lookup is first step before any progress events). Availability refactor is low-risk cleanup. Integration ties it all together.

## Implementation Landscape

### Key Files

**New files to create:**
- `src/cache.ts` — In-session cache with `Map<string, SearchResult>`, normalized query keys, session reset on `session_start`
- `src/cache.test.ts` — Tests for cache get/set, normalization, session reset
- `src/availability.ts` — Extracted availability check (refactor from index.ts)
- `src/availability.test.ts` — Tests for CLI binary detection and credential file presence

**Files to modify:**
- `src/index.ts` — Update `execute()` signature to `(toolCallId, params, signal, onUpdate, ctx)`, integrate cache lookup, wire `onUpdate` to `executeSearch()`, extract availability to separate module
- `src/gemini-cli.ts` — Add `onUpdate?: (message: string) => void` to `SearchOptions`, call `onUpdate()` at key stages (start, parsing, URL resolution, complete)
- `src/types.ts` — Add `onUpdate?: (message: string) => void` to `SearchOptions` interface

### Build Order

1. **Types first** — Add `onUpdate` to `SearchOptions` in `src/types.ts` (unblocks gemini-cli.ts changes)
2. **Cache module** — Create `src/cache.ts` (independent, no dependencies)
3. **Availability module** — Extract to `src/availability.ts` (independent)
4. **Gemini CLI integration** — Wire `onUpdate` into `executeSearch()` (depends on types)
5. **Tool registration** — Update execute handler, integrate cache and progress (depends on all above)

### Verification Approach

- **TypeScript compilation:** `npx tsc --noEmit` — 0 errors
- **Unit tests:** `npm test` — Expect ~60 tests total (41 existing + ~19 new):
  - cache.test.ts: ~8 tests (get/set, normalization, session reset)
  - availability.test.ts: ~5 tests (CLI presence, credential file, combined)
  - Updated gemini-cli.test.ts: ~3 tests for onUpdate callbacks
  - Updated index.test.ts: ~3 tests for cache integration
- **Integration test:** Run same query twice in same session — second call returns cached result instantly (no subprocess)
- **Manual verification:** 
  - Query "what is TypeScript", verify progress messages appear
  - Cancel mid-search, verify subprocess terminates
  - Run identical query twice, verify second is instant (cached)

## Requirements Coverage

| Requirement | Status in S01 | S02 Action |
|-------------|---------------|------------|
| R004 — In-session query caching | ❌ Not implemented | **Build new `src/cache.ts`** |
| R005 — Availability detection | ✅ Implemented in index.ts | **Extract to `src/availability.ts`** (refactor) |
| R006 — Progress updates | ❌ Not implemented | **Wire `onUpdate` through execute handler** |
| R007 — Cancellation support | ✅ Implemented in gemini-cli.ts | **Document, no code changes** |
| R008 — Configurable timeout/model | ✅ Implemented via env vars | **Document, no code changes** |
| R009 — Structured error reporting | ✅ Implemented with renderError() | **Document, no code changes** |

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| In-session cache | GSD-2 `google_search` extension uses `Map<string, SearchResult>` with session TTL | Proven pattern; simple Map is sufficient (no need for LRU, TTL per-entry, or persistent storage) |
| Query normalization | Standard approach: `query.toLowerCase().trim()` | Prevents duplicate cache entries for "TypeScript" vs "typescript" |
| Progress streaming | pi extension API provides `onUpdate(partial: string)` callback | No need for custom event emitters or streams |

## Constraints

- **pi extension API signature is fixed** — `execute(toolCallId, params, signal, onUpdate, ctx)` must match exactly; cannot invent custom signature
- **Cache must be in-session only** — Per D008, no persistent cache (adds complexity with invalidation, storage); Map is cleared on `session_start`
- **Backward compatibility not required** — S02 is a new slice; no need to maintain compatibility with S01 internal APIs

## Common Pitfalls

- **Cache key normalization edge cases** — "TypeScript types" and "types TypeScript" are semantically different but would hash the same if sorted. **Avoid:** Do NOT sort words; only lowercase and trim.
- **onUpdate called too frequently** — Calling onUpdate for every NDJSON line would spam the UI. **Solution:** Only call at major milestones (start, parsing, URL resolution, complete).
- **Cache bypass on errors** — Cached results should include errors and warnings. **Solution:** Cache the full `SearchResult` including `error` and `warning` fields.
- **Session reset timing** — Cache must clear on `session_start`, not on tool registration. **Solution:** Register `pi.on('session_start', () => cache.clear())` in index.ts.

## Open Risks

- **onUpdate callback may not be exposed in current pi API** — S01 implementation used simplified signature `execute(params)`. If pi's `registerTool()` doesn't pass `onUpdate` to the handler, progress streaming won't work. **Mitigation:** Check pi extension API docs or test with a simple onUpdate callback.
- **Cache memory growth** — In-session cache could grow large if user makes many unique queries. **Mitigation:** Add max size limit (e.g., 100 entries) with simple FIFO eviction if needed.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| pi extension API | None found | No specific skill needed — extension pattern already established in S01 |

## Sources

- GSD-2 `google_search` extension — In-session caching pattern (Map with session TTL)
- RESEARCH-gemini-cli-search-extension.md — execute() signature with onUpdate, subprocess streaming
- S01-SUMMARY.md — Forward intelligence on what's fragile and what assumptions changed

## Slice S02 Tasks (Draft)

Based on this research, S02 should decompose into:

- **T01: In-session query cache** — `src/cache.ts`, `src/cache.test.ts` (est: 45m)
- **T02: Availability detection module** — `src/availability.ts`, `src/availability.test.ts` (est: 30m)
- **T03: Progress streaming** — Wire `onUpdate` in `src/gemini-cli.ts` and `src/index.ts` (est: 45m)
- **T04: Integration & tests** — Update tests, verify caching, manual UAT (est: 45m)

**Total estimated duration:** ~2.5 hours

---

## Appendix: S01 Implementation Audit

### What S01 Already Implemented (S02 can reuse)

**R005 — Availability detection ✅**
```typescript
// src/index.ts lines 23-48
function checkAvailability(): { available: boolean; reason?: string } {
  // Checks gemini CLI binary via execSync('which gemini')
  // Checks ~/.gemini/oauth_creds.json existence
}
```
**S02 Action:** Extract to dedicated `src/availability.ts` module for clarity.

**R007 — Cancellation support ✅**
```typescript
// src/gemini-cli.ts lines 56-69
if (signal) {
  signal.addEventListener('abort', () => {
    child.kill();
    // ...
  });
}
```
**S02 Action:** No changes needed. Document that AbortSignal is honored.

**R008 — Configurable timeout/model ✅**
```typescript
// src/gemini-cli.ts lines 37-38
const model = options?.model ?? process.env.GEMINI_SEARCH_MODEL ?? 'gemini-2.5-flash';
const timeout = options?.timeout ?? Number(process.env.GEMINI_SEARCH_TIMEOUT ?? 60000);
```
**S02 Action:** No changes needed. Document environment variables.

**R009 — Structured error reporting ✅**
```typescript
// src/index.ts lines 90-112
function renderError(result: SearchResult): string {
  const errorMessages: Record<string, string> = {
    CLI_NOT_FOUND: 'Gemini CLI is not installed...',
    NOT_AUTHENTICATED: 'Gemini CLI authentication failed',
    TIMEOUT: 'Search timed out',
    PARSE_ERROR: 'Failed to parse Gemini CLI output',
    SEARCH_FAILED: 'Search operation failed',
  };
  // ...
}
```
**S02 Action:** No changes needed. Error types already machine-distinguishable.

### What S01 Did NOT Implement (S02 must build)

**R004 — In-session query caching ❌**
- No cache module exists
- No cache lookup in execute handler
- No session reset logic

**R006 — Progress updates ❌**
- `onUpdate` callback not in execute signature
- No progress messages streamed during execution
- execute() uses simplified signature: `async (params: { query: string })`
- Should be: `async (toolCallId, params, signal, onUpdate, ctx)`
