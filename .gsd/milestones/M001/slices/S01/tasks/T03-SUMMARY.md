---
id: T03
parent: S01
milestone: M001
provides:
  - Gemini CLI subprocess execution with NDJSON parsing
  - Search detection (google_web_search tool_use events)
  - Markdown link extraction from assistant responses
  - Automatic warning when Gemini answers from memory
key_files:
  - src/gemini-cli.ts
  - src/gemini-cli.test.ts
  - src/fixtures/fixture-with-search.jsonl
  - src/fixtures/fixture-without-search.jsonl
  - src/fixtures/fixture-multiple-sources.jsonl
key_decisions:
  - Aligned NDJSON parsing with actual Gemini CLI output format (type: 'message', role: 'assistant', content: string, delta: boolean)
  - Used Promise-based subprocess handling with proper cleanup on timeout/abort
patterns_established:
  - Line-by-line NDJSON parsing with graceful error handling per-line
  - Structured error types (CLI_NOT_FOUND, TIMEOUT, PARSE_ERROR, SEARCH_FAILED, NOT_AUTHENTICATED)
  - Search verification via tool_use event detection
observability_surfaces:
  - Structured SearchResult with warning field for NO_SEARCH detection
  - Structured SearchError with machine-distinguishable type field
  - Console warnings for malformed NDJSON lines during development
duration: 90m
verification_result: passed
completed_at: 2026-03-16T22:52:00Z
blocker_discovered: false
---

# T03: Implement Gemini CLI Subprocess Execution and Parsing

**Implemented core subprocess execution and NDJSON parsing for Gemini CLI integration.**

## What Happened

Implemented `executeSearch(query: string, options?: SearchOptions): Promise<SearchResult>` in `src/gemini-cli.ts`:

1. **Subprocess spawning**: Uses `child_process.spawn()` with flags `-o stream-json -p "<prompt>" --yolo -m <model>`
2. **NDJSON parsing**: Line-by-line parsing of Gemini CLI JSON output, tracking:
   - `tool_use` events with `tool_name === 'google_web_search'` for search detection
   - `message` events with `role === 'assistant'` for answer text concatenation
3. **Link extraction**: Regex `/[([^\]]+)\](([^)]+))/g` extracts markdown links from assistant text
4. **URL resolution**: Calls `resolveGroundingUrls()` on extracted links
5. **Warning generation**: Returns `NO_SEARCH` warning when no `google_web_search` tool use detected
6. **Error handling**: Structured errors for CLI_NOT_FOUND, NOT_AUTHENTICATED, TIMEOUT, PARSE_ERROR, SEARCH_FAILED
7. **Cancellation support**: Honors AbortSignal for request cancellation

Created three NDJSON test fixtures in `src/fixtures/`:
- `fixture-with-search.jsonl` — Real Gemini CLI output format with google_web_search tool_use
- `fixture-without-search.jsonl` — Memory answer without tool use
- `fixture-multiple-sources.jsonl` — Multiple grounding source links

Implemented 10 unit tests + 1 integration test in `src/gemini-cli.test.ts` covering:
- Fixture parsing and search detection
- Assistant message extraction
- Markdown link extraction
- Error handling (CLI not found, timeout, abort signal)
- SearchResult structure validation

**Key implementation detail**: Discovered actual Gemini CLI NDJSON format differs from initial assumptions:
- Assistant messages: `{"type":"message","role":"assistant","content":"...","delta":true}` (not `{"type":"assistant","text":"..."}`)
- Updated both implementation and test fixtures to match real format

## Verification

- ✅ `npx tsc --noEmit` — No TypeScript errors
- ✅ `npm test` — All 31 tests pass (10 gemini-cli tests, 9 types tests, 12 url-resolver tests)
- ✅ Manual integration test: Query "what is 2+2" → Returns answer with `NO_SEARCH` warning (correct behavior for simple arithmetic)
- ✅ Verified actual Gemini CLI output format matches fixture format

## Diagnostics

- **Success inspection**: Check `result.warning === undefined` and `result.sources.length > 0` for successful search
- **Memory answer**: Check `result.warning?.type === 'NO_SEARCH'` when Gemini answers without searching
- **Error inspection**: Check `result.error?.type` for machine-distinguishable error categories
- **Runtime logs**: Console warnings for malformed NDJSON lines (development only)

## Deviations

None — implementation matches task plan exactly.

## Known Issues

None — all must-haves implemented and verified.

## Files Created/Modified

- `src/gemini-cli.ts` — 219 lines, core subprocess execution and NDJSON parsing
- `src/gemini-cli.test.ts` — 224 lines, fixture-based unit tests + integration tests
- `src/fixtures/fixture-with-search.jsonl` — NDJSON fixture with google_web_search tool use
- `src/fixtures/fixture-without-search.jsonl` — NDJSON fixture without search (memory answer)
- `src/fixtures/fixture-multiple-sources.jsonl` — NDJSON fixture with 4 grounding links
- `.gsd/milestones/M001/slices/S01/S01-PLAN.md` — Updated T03 checklist to [x]
