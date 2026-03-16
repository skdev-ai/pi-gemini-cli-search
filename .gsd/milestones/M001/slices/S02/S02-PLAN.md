---
id: S02
parent: M001
milestone: M001
title: Operability & resilience
status: planning
---

# S02: Operability & Resilience — Plan

**Goal:** Extension handles errors gracefully, caches repeated queries, detects availability, streams progress, and supports cancellation.

**Demo:** 
- Query "what is TypeScript" → returns answer with progress messages ("Starting search…", "Parsing response…", "Resolving X source URLs…", "Complete")
- Same query repeated → returns cached result instantly (no subprocess execution)
- Cancel mid-search → subprocess terminates cleanly
- Run without gemini CLI installed → clear error "Gemini CLI is not installed"

## Must-Haves

- In-session query cache with normalized query keys (lowercase, trimmed)
- Cache cleared on `session_start` event
- Progress streaming via `onUpdate` callback at major milestones
- Availability detection extracted to dedicated module
- TypeScript compilation with 0 errors
- All new functionality covered by unit tests

## Proof Level

- This slice proves: **operational** — real runtime behavior with caching, progress streaming, and availability detection
- Real runtime required: **yes** — cache must prevent subprocess execution, onUpdate must stream messages
- Human/UAT required: **yes** — manual verification of progress messages and caching behavior

## Verification

- `npx tsc --noEmit` — 0 TypeScript errors
- `npm test` — ~60 tests pass (41 existing + ~19 new):
  - `src/cache.test.ts` — ~8 tests (get/set, normalization, session reset)
  - `src/availability.test.ts` — ~5 tests (CLI presence, credential file, combined)
  - `src/gemini-cli.test.ts` — ~3 new tests for onUpdate callbacks
  - `src/index.test.ts` — ~3 new tests for cache integration
- Integration verification: Run same query twice in same session — second call returns cached result instantly
- Manual UAT: See S02-UAT.md for test cases

## Observability / Diagnostics

- Runtime signals: Cache hit/miss logged to console (`[gemini-cli-search] Cache hit for query: ...`)
- Inspection surfaces: Cache size tracked internally; `cache.size()` for diagnostics
- Failure visibility: Cache errors logged but don't block search; availability errors logged on session_start
- Redaction constraints: None — queries are not sensitive

## Integration Closure

- Upstream surfaces consumed: `gemini-cli.ts` subprocess execution, `url-resolver.ts` URL resolution, `types.ts` shared types
- New wiring introduced in this slice: `cache.ts` module, `availability.ts` module, `onUpdate` callback wired through execute handler
- What remains before the milestone is truly usable end-to-end: Integration tests and comprehensive UAT (S03)

## Tasks

- [x] **T01: In-session query cache** `est:45m`
  - Why: R004 requires caching repeated queries; highest-value feature in S02 — prevents redundant subprocess execution
  - Files: `src/cache.ts`, `src/cache.test.ts`, `src/types.ts`
  - Do: Create `src/cache.ts` with `Map<string, SearchResult>` storage; implement `get(query)`, `set(query, result)`, `clear()`, `size()`; normalize query keys via `query.toLowerCase().trim()`; register `pi.on('session_start', () => cache.clear())` in index.ts; export cache type from types.ts
  - Verify: `npm test -- cache.test.ts` — 8 tests pass; manual: run same query twice, verify second is instant
  - Done when: Cache module has 100% function coverage, integration test proves cache hit skips subprocess

- [ ] **T02: Availability detection module** `est:30m`
  - Why: R005 already implemented in index.ts but needs extraction to dedicated module for clarity and reusability
  - Files: `src/availability.ts`, `src/availability.test.ts`, `src/index.ts`
  - Do: Extract `checkAvailability()` logic from index.ts into `src/availability.ts` with `export function checkAvailability(): { available: boolean; reason?: string }` and `export function isAvailable(): boolean`; add tests for CLI binary detection, credential file detection, combined scenarios; update index.ts to import from availability module
  - Verify: `npm test -- availability.test.ts` — 5 tests pass; `npx tsc --noEmit` — 0 errors
  - Done when: Availability functions are in dedicated module with tests; index.ts imports and uses them

- [ ] **T03: Progress streaming** `est:45m`
  - Why: R006 requires progress updates during search; users need visibility into ~10-second search duration
  - Files: `src/types.ts`, `src/gemini-cli.ts`, `src/index.ts`
  - Do: Add `onUpdate?: (message: string) => void` to `SearchOptions` in types.ts; wire `onUpdate` through `executeSearch(query, options)` in gemini-cli.ts — call at major milestones (start, parsing, URL resolution, complete); update execute handler in index.ts to use full signature `(toolCallId, params, signal, onUpdate, ctx)` and pass `onUpdate` to `executeSearch()`
  - Verify: `npm test -- gemini-cli.test.ts` — 3 new tests for onUpdate callbacks; manual: query "what is TypeScript", verify progress messages appear
  - Done when: onUpdate called at 4+ milestones; tests verify callback is invoked with expected messages

- [ ] **T04: Integration & documentation** `est:45m`
  - Why: Tie all S02 features together; ensure caching, availability, and progress work in concert
  - Files: `src/index.ts`, `src/gemini-cli.ts`, `.gsd/milestones/M001/slices/S02/S02-UAT.md`
  - Do: Integrate cache lookup as first step in execute handler (before any progress events); wire availability check before execution; document environment variables (`GEMINI_SEARCH_MODEL`, `GEMINI_SEARCH_TIMEOUT`) in README; create S02-UAT.md with manual test cases; run full test suite
  - Verify: `npm test` — ~60 tests pass; manual UAT: all test cases in S02-UAT.md pass
  - Done when: Full test suite passes; manual UAT verifies caching, progress, cancellation, and error messages

## Files Likely Touched

- `src/cache.ts` (new)
- `src/cache.test.ts` (new)
- `src/availability.ts` (new)
- `src/availability.test.ts` (new)
- `src/types.ts` (modify — add onUpdate to SearchOptions)
- `src/gemini-cli.ts` (modify — wire onUpdate)
- `src/index.ts` (modify — integrate cache, use availability module, update execute signature)
- `.gsd/milestones/M001/slices/S02/S02-UAT.md` (new)

## Requirements Coverage

| Requirement | Status | S02 Action |
|-------------|--------|------------|
| R004 — In-session query caching | **Implemented** | T01: Build new `src/cache.ts` |
| R005 — Availability detection | **Implemented** | T02: Extract to `src/availability.ts` |
| R006 — Progress updates | **Implemented** | T03: Wire `onUpdate` through execute handler |
| R007 — Cancellation support | **Documented** | No code changes — already implemented in S01 |
| R008 — Configurable timeout/model | **Documented** | No code changes — already implemented in S01 |
| R009 — Structured error reporting | **Documented** | No code changes — already implemented in S01 |
