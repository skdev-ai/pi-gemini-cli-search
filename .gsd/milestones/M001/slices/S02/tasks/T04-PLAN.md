# T04: Integration & Documentation — Plan

**Description:** Integrate all S02 features (caching, availability, progress) into cohesive whole; document environment variables; create UAT test plan; run full verification.

## Must-Haves

- Cache lookup integrated as first step in execute handler (before any progress events)
- Availability check runs before execution, returns clear error if unavailable
- Full test suite passes (~60 tests total)
- Environment variables documented: `GEMINI_SEARCH_MODEL`, `GEMINI_SEARCH_TIMEOUT`
- S02-UAT.md created with manual test cases

## Files

- `src/index.ts` (modify — integrate cache, availability, progress)
- `src/gemini-cli.ts` (modify — ensure cache bypasses onUpdate calls)
- `.gsd/milestones/M001/slices/S02/S02-UAT.md` (new)
- `README.md` (modify — add environment variables section)

## Steps

1. **Integrate cache into execute handler (`src/index.ts`):**
   - Ensure cache lookup happens BEFORE any other logic:
     ```typescript
     const cached = cache.get(params.query);
     if (cached) {
       console.log('[gemini-cli-search] Cache hit for query:', params.query);
       return cached;
     }
     ```
   - After successful search (or error), cache the result:
     ```typescript
     cache.set(params.query, result);
     return result;
     ```
   - Verify: cache hit skips ALL progress events (no subprocess, no onUpdate calls)

2. **Integrate availability check:**
   - Call `checkAvailability()` before cache lookup or search execution
   - If unavailable, return structured error immediately:
     ```typescript
     const availability = checkAvailability();
     if (!availability.available) {
       return { error: { type: availability.reason, message: '...' } };
     }
     ```

3. **Document environment variables (`README.md`):**
   - Add section "Configuration" with:
     ```markdown
     ## Configuration

     The following environment variables can be set to customize behavior:

     - `GEMINI_SEARCH_MODEL` — Gemini model to use (default: `gemini-2.5-flash`)
     - `GEMINI_SEARCH_TIMEOUT` — Timeout in milliseconds (default: `60000`)

     Example:
     ```bash
     export GEMINI_SEARCH_MODEL=gemini-2.5-pro
     export GEMINI_SEARCH_TIMEOUT=120000
     ```
     ```

4. **Create S02-UAT.md:**
   - Document manual test cases:
     - Test 1: First query returns answer with progress messages
     - Test 2: Repeated query returns cached result (instant)
     - Test 3: Cancel mid-search terminates subprocess
     - Test 4: Run without gemini CLI shows clear error
     - Test 5: Run without auth shows clear error
     - Test 6: Custom model via env var works
     - Test 7: Custom timeout via env var works

5. **Run full test suite:**
   - `npm test` — expect ~60 tests pass
   - `npx tsc --noEmit` — 0 errors
   - Fix any integration issues

## Verification

- `npm test` — ~60 tests pass (41 existing + ~19 new)
- `npx tsc --noEmit` — 0 TypeScript errors
- Manual UAT: All 7 test cases in S02-UAT.md pass
- Integration test: Run same query twice in same session:
  - First call: ~10 seconds, shows progress messages
  - Second call: <100ms, no progress messages (cached)

## Inputs

- T01: Cache module (`src/cache.ts`)
- T02: Availability module (`src/availability.ts`)
- T03: Progress streaming (`onUpdate` wired through gemini-cli.ts)
- S01: Base implementation (types, gemini-cli, url-resolver, index)

## Expected Output

- Updated `src/index.ts` — cache, availability, and progress fully integrated
- Updated `README.md` — environment variables documented
- `.gsd/milestones/M001/slices/S02/S02-UAT.md` — 7 manual test cases
- Full test suite passing

## Observability Impact

- **Unified signals:** Cache hits logged, progress messages streamed, availability errors explicit
- **Failure visibility:** Every failure mode has clear diagnostic:
  - Cache miss → subprocess executes with progress
  - CLI missing → "Gemini CLI is not installed"
  - Auth missing → "Gemini CLI authentication failed"
  - Timeout → "Search timed out after X ms"
  - Search failed → "Search operation failed"
