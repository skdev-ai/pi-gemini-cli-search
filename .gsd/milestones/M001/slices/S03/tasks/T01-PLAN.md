# T01: Execute UAT Tests and Document Results

**Description:** Execute all 7 UAT test cases from S02-SUMMARY.md with real Gemini CLI and OAuth credentials, documenting pass/fail results and actual output for each test.

## Steps

1. **Verify prerequisites**
   - Run `gemini --version` — must return version number
   - Check `ls -la ~/.gemini/oauth_creds.json` — file must exist
   - If either fails, document as environment issue and skip runtime tests

2. **Prepare test environment**
   - Ensure extension is built: `npm run build` (if build script exists) or verify `dist/` directory
   - Clear any existing cache to ensure clean test state
   - Set up log capture for console output

3. **Execute Test 1: First query (happy path)**
   - Query: "What is the capital of France?"
   - Expected: Answer text + 2+ resolved source URLs + progress messages + no errors
   - Check for: `google_web_search` tool_use detection (warning if absent)
   - Record: Answer text (first 200 chars), source URLs, execution time, any warnings

4. **Execute Test 2: Repeated query (cache hit)**
   - Same query as Test 1
   - Expected: Instant response (<100ms), no subprocess execution
   - Check for: Console log "Cache hit for query: ..."
   - Record: Response time, cache hit confirmation

5. **Execute Test 3: Cancellation**
   - Start a query that takes time (e.g., "Explain quantum computing in detail")
   - Cancel mid-execution via pi's cancellation mechanism
   - Expected: Subprocess terminates, no orphan processes
   - Check: `ps aux | grep gemini` — no hanging subprocesses
   - Record: Cancellation latency, process cleanup confirmation

6. **Execute Test 4: Missing CLI error**
   - Temporarily rename gemini binary or modify PATH
   - Run query
   - Expected: Error code `CLI_NOT_FOUND`, message "Gemini CLI not found"
   - Restore CLI availability after test

7. **Execute Test 5: Missing auth error**
   - Temporarily rename `~/.gemini/oauth_creds.json`
   - Run query
   - Expected: Error code `NOT_AUTHENTICATED`, message "OAuth credentials not found"
   - Restore credentials after test

8. **Execute Test 6: Custom model**
   - Set `GEMINI_SEARCH_MODEL=gemini-2.0-pro` (or another available model)
   - Run query
   - Expected: Query executes with specified model (check Gemini CLI logs if available)
   - Record: Model used, any differences in response quality/speed

9. **Execute Test 7: Custom timeout**
   - Set `GEMINI_SEARCH_TIMEOUT=5` (5 seconds)
   - Run a query that might take longer
   - Expected: Timeout error if query exceeds 5s, or successful completion if faster
   - Record: Actual timeout behavior

10. **Write results**
    - Create `S03-UAT-RESULTS.md` with structured results for each test
    - Include: Test ID, description, pass/fail, actual output, execution time, notes

## Must-Haves

- All 7 tests executed (or documented as skipped with reason)
- Actual output captured for each test (not just pass/fail)
- Execution times recorded where relevant
- Environment issues documented clearly

## Verification

- `S03-UAT-RESULTS.md` exists with complete test records
- At least 6/7 tests pass (Test 3 cancellation may be environment-dependent)
- Test failures have clear root cause analysis

## Inputs

- Working Gemini CLI installation with OAuth credentials
- Extension built and loadable in pi
- S02-UAT.md test cases as reference

## Expected Output

- `S03-UAT-RESULTS.md` with format:
  ```markdown
  ## Test 1: First Query (Happy Path)
  - Status: PASS / FAIL
  - Query: "What is the capital of France?"
  - Execution time: 8.2s
  - Answer: "The capital of France is Paris..." (truncated)
  - Sources: ["https://en.wikipedia.org/wiki/Paris", "https://www.britannica.com/..."]
  - Progress messages: ["Starting search...", "Parsing response...", "Resolving 2 source URLs...", "Complete"]
  - Warnings: [none / "No search detected - Gemini answered from memory"]
  - Notes: <any observations>
  ```

## Observability Impact

- Console logs must show: cache hits, availability checks, progress messages, error codes
- Process cleanup visible via `ps aux | grep gemini` after cancellation test
- Environment variable usage visible in Gemini CLI logs (if accessible)
