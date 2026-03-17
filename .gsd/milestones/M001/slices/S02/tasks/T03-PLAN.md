# T03: Progress Streaming — Plan

**Description:** Wire `onUpdate` callback through execute handler to `executeSearch()`, streaming progress messages at major milestones during subprocess execution.

## Must-Haves

- `onUpdate?: (message: string) => void` added to `SearchOptions` in types.ts
- Progress messages at 4+ milestones: "Starting search…", "Parsing response…", "Resolving X source URLs…", "Complete"
- Execute handler signature updated to full pi extension API: `(toolCallId, params, signal, onUpdate, ctx)`
- onUpdate called only at major milestones (not for every NDJSON line)
- Tests verify onUpdate callback is invoked with expected messages

## Files

- `src/types.ts` (modify — add onUpdate to SearchOptions)
- `src/gemini-cli.ts` (modify — call onUpdate at milestones)
- `src/index.ts` (modify — update execute signature, pass onUpdate)
- `src/gemini-cli.test.ts` (modify — add tests for onUpdate)

## Steps

1. **Update `src/types.ts`:**
   - Add `onUpdate?: (message: string) => void` to `SearchOptions` interface:
     ```typescript
     export interface SearchOptions {
       model?: string;
       timeout?: number;
       signal?: AbortSignal;
       onUpdate?: (message: string) => void;
     }
     ```

2. **Update `src/gemini-cli.ts`:**
   - Add `onUpdate` parameter to `executeSearch()` signature
   - Call `onUpdate('Starting search…')` before spawning subprocess
   - Call `onUpdate('Parsing response…')` after subprocess completes, before NDJSON parsing
   - Call `onUpdate(\`Resolving ${urls.length} source URLs…\`)` before URL resolution
   - Call `onUpdate('Complete')` before returning result
   - Guard all calls with `if (onUpdate)` to handle optional callback

3. **Update `src/index.ts`:**
   - Update execute handler signature from:
     ```typescript
     async (params: { query: string }) => { ... }
     ```
     to:
     ```typescript
     async (toolCallId, params, signal, onUpdate, ctx) => { ... }
     ```
   - Pass `onUpdate` to `executeSearch()`:
     ```typescript
     const result = await executeSearch(params.query, {
       signal,
       onUpdate,
     });
     ```

4. **Update `src/gemini-cli.test.ts`:**
   - Add test: onUpdate called with "Starting search…"
   - Add test: onUpdate called with "Resolving X source URLs…"
   - Add test: onUpdate called with "Complete"
   - Mock onUpdate as jest.fn(), verify toHaveBeenCalledWith expected messages

## Verification

- `npx tsc --noEmit` — 0 TypeScript errors
- `npm test -- gemini-cli.test.ts` — 3 new tests pass (total ~14 tests in file)
- Manual: Run query "what is TypeScript", verify progress messages appear in pi UI
- Verify: onUpdate NOT called for every NDJSON line (only 4-5 times total)

## Inputs

- S01 implementation: `executeSearch()` in `src/gemini-cli.ts`
- S01 implementation: `SearchOptions` interface in `src/types.ts`
- pi extension API: execute handler signature with onUpdate callback

## Expected Output

- Updated `src/types.ts` — SearchOptions with optional onUpdate
- Updated `src/gemini-cli.ts` — 4+ onUpdate calls at milestones
- Updated `src/index.ts` — full execute signature, onUpdate passed through
- Updated `src/gemini-cli.test.ts` — 3 new tests for progress streaming

## Observability Impact

- **New signal:** Progress messages streamed to pi UI — users see real-time status
- **Failure visibility:** If search hangs, last progress message indicates where it stuck (e.g., "Parsing response…" but never "Resolving URLs…")
- **No redaction needed** — progress messages don't contain sensitive data
