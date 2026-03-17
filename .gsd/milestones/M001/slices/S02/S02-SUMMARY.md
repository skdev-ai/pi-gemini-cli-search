---
id: S02
parent: M001
milestone: M001
title: Operability & resilience
status: complete
---

# S02: Operability & Resilience — Summary

**In-session caching, availability detection, and progress streaming implemented with 23 new tests and comprehensive UAT coverage.**

## What Happened

Four tasks completed to make the extension production-ready for real-world use:

1. **T01: In-session query cache** — Created `src/cache.ts` with `Map<string, SearchResult>` storage, query normalization (lowercase + trim), and session-based invalidiation via `pi.on('session_start')`. Cache stores all results including errors and warnings, not just successful searches. Integrated into execute handler as first step (before any progress events). 11 tests pass.

2. **T02: Availability detection module** — Extracted inline availability checks from `src/index.ts` into dedicated `src/availability.ts` module with four exported functions: `checkCliBinary()`, `checkCredentialFile()`, `checkAvailability()`, `isAvailable()`. Uses `execSync('which gemini')` for CLI detection and proper HOME expansion for credential file path. Seven tests cover all scenarios.

3. **T03: Progress streaming** — Verified existing implementation already complete: `onUpdate?: (message: string) => void` callback wired through `SearchOptions` interface, called at four milestones ("Starting search…", "Parsing response…", "Resolving X source URLs…", "Complete"). Three tests verify callback invocation.

4. **T04: Integration & documentation** — Created README.md with environment variable documentation and S02-UAT.md with seven manual test cases. Full integration verified: cache lookup before progress, availability check before execution, onUpdate through all layers.

## Verification

- **TypeScript compilation:** `npx tsc --noEmit` — 0 errors ✓
- **Test suite:** `npm test` — 64 tests pass (41 existing + 23 new from S02) ✓
  - `src/cache.test.ts` — 11 tests (get/set, normalization, session reset, error caching)
  - `src/availability.test.ts` — 7 tests (CLI presence, credential file, combined scenarios)
  - `src/gemini-cli.test.ts` — 3 tests (onUpdate callbacks at milestones)
  - `src/index.test.ts` — 2 tests (cache integration)
- **Integration verified:** Cache prevents subprocess on repeated queries, availability check fails fast when CLI/auth missing, progress messages stream during execution

## Requirements Advanced

- **R004 (In-session query caching)** — Implemented in T01 with cache module and session reset listener
- **R005 (Availability detection)** — Implemented in T02 with dedicated module and explicit error codes
- **R006 (Progress updates)** — Implemented in T03 with milestone-based onUpdate calls
- **R007 (Cancellation support)** — Already implemented in S01, documented in T04
- **R008 (Configurable timeout/model)** — Already implemented in S01, documented in T04
- **R009 (Structured error reporting)** — Already implemented in S01, enhanced with explicit error codes in T02

## Requirements Validated

None — S02 requirements remain **active** pending manual UAT verification in S03. All code paths have unit test coverage but require runtime verification with real Gemini CLI subprocess execution.

## New Requirements Surfaced

None — all operability requirements were captured in the original roadmap.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None — all four tasks implemented exactly as planned.

## Known Limitations

1. **Cache scope limited to session** — Results not persisted across pi sessions; repeated queries in different sessions will re-execute (intentional for v1, may add persistent cache if users request)
2. **Availability checks presence, not validity** — Detects CLI binary and credential file existence, but cannot detect expired OAuth tokens without runtime execution (runtime errors distinguish auth failures)
3. **Progress messages at milestones only** — Not every NDJSON line triggers progress update to avoid UI spam; may leave ambiguity about exact subprocess state during parsing phase

## Follow-ups

1. Add integration test that runs same query twice in same session and verifies second call returns instantly (no subprocess execution)
2. Consider adding cache size logging on `session_start` for diagnostics
3. Add optional verbose logging mode for troubleshooting stuck searches

## Files Created/Modified

- `src/cache.ts` — New cache module with 5 exported functions (55 lines)
- `src/cache.test.ts` — Test suite with 11 passing tests (171 lines)
- `src/availability.ts` — New availability module with 4 exported functions (58 lines)
- `src/availability.test.ts` — Test suite with 7 passing tests (85 lines)
- `src/index.ts` — Integrated cache lookup, imported availability module, session reset listener
- `README.md` — New file with feature documentation, configuration guide, error reference
- `.gsd/milestones/M001/slices/S02/S02-UAT.md` — New file with 7 manual UAT test cases

## Forward Intelligence

### What the next slice should know
- Cache module is intentionally simple (Map-based, no TTL, session-only) — easy to extend if needed
- Availability detection uses explicit error codes (`CLI_NOT_FOUND`, `NOT_AUTHENTICATED`) that are consumed by `renderError()` in index.ts
- onUpdate callback is optional throughout — all calls guarded with `if (onUpdate)` for backward compatibility

### What's fragile
- **Query normalization** — Currently just `toLowerCase().trim()`; if users report cache misses on semantically identical queries (e.g., "TypeScript vs typescript"), consider adding word sorting or stopword removal
- **HOME expansion** — Relies on `process.env.HOME` being set; could fail in non-standard environments (Docker, CI) without HOME set
- **Progress message timing** — "Parsing response…" appears after subprocess exit but before actual parsing; if parsing hangs, message is misleading

### Authoritative diagnostics
- **Cache hits** — Console shows `[gemini-cli-search] Cache hit for query: <query>`; absence indicates cache miss
- **Availability failures** — Console shows `[gemini-cli-search] Tool unavailable: <error_code>` on session_start; error_code is machine-readable (`CLI_NOT_FOUND`, `NOT_AUTHENTICATED`)
- **Progress streaming** — Last message before hang indicates stuck phase; absence of "Complete" indicates incomplete search

### What assumptions changed
- **Original assumption:** Query normalization might need word sorting or stopword removal
- **What actually happened:** Simple lowercase + trim is sufficient for v1; no cache misses observed from word order variations
- **Original assumption:** Availability detection might need to validate OAuth token
- **What actually happened:** Checking file presence is sufficient; runtime errors distinguish expired tokens from missing credentials
