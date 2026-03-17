# S01: Core Search Functionality — UAT

**Milestone:** M001
**Written:** 2026-03-16

## UAT Type

- UAT mode: **live-runtime**
- Why this mode is sufficient: S01 delivers executable tool with real subprocess integration; unit tests prove parsing logic, but only live execution with actual Gemini CLI proves end-to-end functionality. Artifact-driven testing insufficient for verifying OAuth auth, network resolution, and real NDJSON output.

## Preconditions

1. Gemini CLI installed and accessible as `gemini` binary (`which gemini` returns path)
2. OAuth credentials present at `~/.gemini/oauth_creds.json` (run `gemini` interactively once to authenticate)
3. Node.js 20+ installed with npm
4. Extension dependencies installed: `npm install` in worktree directory
5. TypeScript compiles without errors: `npx tsc --noEmit`
6. All unit tests pass: `npm test` (41 tests expected)

## Smoke Test

1. Run `npm test` — all 41 tests pass
2. Load extension in pi agent — `gemini_cli_search` appears in tool list with description
3. Execute query "what is 2+2" — returns answer with `NO_SEARCH` warning (correct for arithmetic)

## Test Cases

### 1. Web Search Query with Source Resolution

**Purpose:** Verify R001, R002, R003 — subprocess execution, NDJSON parsing, URL resolution

1. Execute `gemini_cli_search` tool with query: "latest TypeScript version 2026"
2. Wait for response (typically 5-15 seconds)
3. **Expected:**
   - `result.answer` contains synthesized answer text
   - `result.sources` array contains 2+ resolved URLs
   - Source URLs show actual domains (e.g., `https://www.typescriptlang.org/...`), NOT opaque `vertexaisearch.cloud.google.com` redirect URLs
   - `result.warning` is `undefined` (search was performed)
   - `result.error` is `undefined`

### 2. Memory Answer Detection (NO_SEARCH Warning)

**Purpose:** Verify R010 — search verification detects when Gemini answers from memory

1. Execute `gemini_cli_search` tool with query: "what is 2+2"
2. Wait for response
3. **Expected:**
   - `result.answer` contains "4" or equivalent arithmetic answer
   - `result.sources` array is empty or has 0 grounding links
   - `result.warning.type === 'NO_SEARCH'`
   - `result.warning.message` indicates Gemini answered without web search
   - LLM receives warning and can inform user answer may not be current

### 3. CLI Not Found Error

**Purpose:** Verify R009 — structured error reporting distinguishes failure modes

1. Temporarily rename `gemini` binary or modify PATH to exclude it
2. Execute `gemini_cli_search` tool with query: "test query"
3. **Expected:**
   - `result.error.type === 'CLI_NOT_FOUND'`
   - `result.error.message` contains actionable guidance (e.g., "Install Gemini CLI: npm install -g @anthropic/gemini-cli")
   - Tool execution completes quickly (< 1 second, no subprocess timeout wait)

### 4. Timeout Error

**Purpose:** Verify R009 — timeout error distinguished from other failures

1. Set `GEMINI_SEARCH_TIMEOUT=1` environment variable (or mock slow response)
2. Execute `gemini_cli_search` tool with query: "comprehensive history of software engineering"
3. **Expected:**
   - `result.error.type === 'TIMEOUT'`
   - `result.error.message` indicates subprocess exceeded timeout limit
   - Subprocess terminated cleanly (no zombie processes: `ps aux | grep gemini` shows no hanging processes)

### 5. Multiple Sources in Single Response

**Purpose:** Verify R002 — NDJSON parsing extracts all grounding links

1. Execute query likely to return multiple sources: "compare React vs Vue vs Svelte 2026"
2. **Expected:**
   - `result.sources.length >= 3` (one per framework comparison)
   - All sources resolved to actual domains
   - `GroundingUrl.resolvedSuccessfully === true` for all sources (or graceful fallback with `resolvedSuccessfully === false`)

### 6. Concurrent URL Resolution

**Purpose:** Verify T02 — Promise.all concurrent execution

1. Execute query returning 5+ sources: "top 10 AI tools for developers 2026"
2. Measure execution time (should be dominated by slowest HEAD request, not sum of all)
3. **Expected:**
   - Total URL resolution time < 3 seconds for 5+ URLs (concurrent, not sequential)
   - All URLs resolved or fallback applied
   - No single URL failure blocks others

## Edge Cases

### Partial URL Resolution Failure

1. Execute query with mix of valid and invalid grounding URLs (simulate with network filter or recorded fixture)
2. **Expected:**
   - Successfully resolved URLs have `resolvedSuccessfully === true` and `resolved` contains redirect target
   - Failed URLs have `resolvedSuccessfully === false` and `resolved === original` (fallback)
   - Overall result still returned (not rejected) — per-URL isolation works

### NDJSON Parse Error Recovery

1. Inject malformed JSON line into NDJSON stream (test fixture or proxy)
2. **Expected:**
   - Malformed line logged to console.warn
   - Parsing continues with subsequent lines
   - Result assembled from successfully parsed lines
   - `result.error.type === 'PARSE_ERROR'` only if no valid assistant message extracted

### Abort Signal / Cancellation

1. Execute long-running query with abort signal triggered mid-execution
2. **Expected:**
   - Subprocess terminated via `.kill()`
   - Promise rejects or returns structured error
   - No zombie processes remain
   - Cleanup occurs (file handles closed, listeners removed)

## Failure Signals

- **Tool not appearing in pi agent tool list** — Extension failed to register; check `src/index.ts` compilation
- **All queries return NO_SEARCH warning** — Gemini CLI may not be authenticated; check `~/.gemini/oauth_creds.json`
- **All URLs remain as vertexaisearch redirects** — HEAD request failing silently; check network connectivity, CORS
- **Subprocess hangs indefinitely** — Timeout not configured or not working; check `--yolo` flag and signal handling
- **TypeScript compilation errors** — Type mismatch between modules; run `npx tsc --noEmit` to diagnose

## Requirements Proved By This UAT

- **R001** — Web search via Gemini CLI subprocess (Test Case 1)
- **R002** — NDJSON parsing with source extraction (Test Cases 1, 5)
- **R003** — Grounding redirect URL resolution (Test Cases 1, 5, 6)
- **R009** — Structured error reporting (Test Cases 3, 4)
- **R010** — Search verification (Test Case 2)

## Not Proven By This UAT

- **R004** — In-session query caching (deferred to S02)
- **R005** — Availability detection on tool registration (partial — binary/credential file check present, token validity not verified)
- **R006** — Progress updates during search (deferred to S02)
- **R007** — Cancellation support (edge case tested but not integrated into tool API)
- **R008** — Configurable timeout and model via environment variables (deferred to S02)

## Notes for Tester

- **Gemini CLI auth is prerequisite** — If you haven't run `gemini` interactively, OAuth credentials won't exist. Run `gemini` once manually before testing.
- **NO_SEARCH is correct behavior for some queries** — Arithmetic, common knowledge, and simple facts don't require web search. Don't treat warning as error.
- **URL resolution may be slow on first run** — DNS lookup + TCP handshake for each HEAD request. Subsequent runs in same session may benefit from OS-level DNS caching.
- **Redirect URLs may expire** — vertexaisearch.cloud.google.com URLs have TTL; if HEAD request takes > 30 seconds, URL may expire before resolution. Fallback uses original URL.
- **Model selection hardcoded for S01** — `gemini-2.5-flash` is default; `GEMINI_SEARCH_MODEL` env var support added in S02.
- **Record actual Gemini CLI output** — If NDJSON format changes, update test fixtures in `src/fixtures/` to match new format.
