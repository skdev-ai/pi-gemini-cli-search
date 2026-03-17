# T03: Implement Gemini CLI Subprocess Execution and Parsing

## Description

Implement core subprocess execution and NDJSON parsing. This is the highest-risk task - proves that Gemini CLI output can be parsed reliably and search verification works.

## Steps

1. Create `src/gemini-cli.ts` with the following implementation:
   - Export `executeSearch(query: string, options: SearchOptions): Promise<SearchResult>`
   - Build prompt using CCS template: "Use the google_web_search tool to search for current information about: <query>"
   - Spawn subprocess: `gemini -o stream-json -p "<prompt>" --yolo -m <model>`
   - Parse NDJSON output line-by-line:
     - Track `tool_use` events to detect `google_web_search` usage
     - Concatenate `assistant` message chunks into full answer text
     - Ignore `user` and `system` events
   - Extract markdown links from answer text using regex `/\[([^\]]+)\]\(([^)]+)\)/g`
   - Call `resolveGroundingUrls()` on extracted links
   - Return `SearchResult` with warning if no `google_web_search` detected

2. Create `src/fixtures/` directory with NDJSON test fixtures:
   - `fixture-with-search.jsonl` — Real Gemini CLI output with google_web_search tool_use
   - `fixture-without-search.jsonl` — Gemini CLI output answering from memory
   - `fixture-multiple-sources.jsonl` — Output with multiple grounding sources

3. Create `src/gemini-cli.test.ts` with tests:
   - Parse fixture-with-search → verify search detected, sources extracted
   - Parse fixture-without-search → verify warning returned
   - Parse fixture-multiple-sources → verify all sources extracted
   - Test subprocess spawn with real Gemini CLI (integration test)

4. Implement error handling:
   - CLI not found → `SearchError` with type `CLI_NOT_FOUND`
   - Parse error → `SearchError` with type `PARSE_ERROR`
   - Timeout → `SearchError` with type `TIMEOUT`
   - Honor abort signal for cancellation

5. Verify all tests pass and manual integration test works

## Must-Haves

- Function signature: `export async function executeSearch(query: string, options?: SearchOptions): Promise<SearchResult>`
- Prompt uses CCS template with explicit "Use the google_web_search tool" instruction
- Subprocess spawned with `child_process.spawn()`, not `spawnSync()`
- NDJSON parsed line-by-line with `JSON.parse()`
- Detects `{"type":"tool_use","tool_name":"google_web_search"}` events
- Extracts markdown links from assistant text
- Calls `resolveGroundingUrls()` on extracted links
- Returns warning when no search detected
- Handles CLI not found, parse errors, timeout
- Honors abort signal for cancellation
- Uses environment variables: `GEMINI_SEARCH_MODEL` (default: `gemini-2.5-flash`), `GEMINI_SEARCH_TIMEOUT` (default: 60000)

## Verification

- `npx tsc --noEmit` — No TypeScript errors
- `npm test -- gemini-cli.test.ts` — All unit tests pass
- Manual test: Run with query "latest TypeScript version" → verify answer with resolved sources
- Manual test: Run with query "what is 2+2" → verify warning (no search needed)

## Inputs

- `src/types.ts` — SearchResult, SearchOptions, SearchWarning, SearchError types
- `src/url-resolver.ts` — resolveGroundingUrls function

## Expected Output

- `src/gemini-cli.ts` — 120-150 lines, core subprocess logic
- `src/gemini-cli.test.ts` — 100-120 lines, fixture-based unit tests + integration test
- `src/fixtures/fixture-with-search.jsonl` — Real NDJSON fixture
- `src/fixtures/fixture-without-search.jsonl` — Memory answer fixture
- `src/fixtures/fixture-multiple-sources.jsonl` — Multiple sources fixture
- All tests pass, manual integration test works

## Observability Impact

- Console logs during development (can be removed or gated behind DEBUG flag)
- Structured error types allow machine-distinguishable error handling
- Warning returned in SearchResult allows LLM to see when Gemini didn't search
