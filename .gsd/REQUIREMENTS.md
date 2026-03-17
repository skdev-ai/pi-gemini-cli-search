# Requirements

This file is the explicit capability and coverage contract for the project.

Use it to track what is actively in scope, what has been validated by completed work, what is intentionally deferred, and what is explicitly out of scope.

Guidelines:
- Keep requirements capability-oriented, not a giant feature wishlist.
- Requirements should be atomic, testable, and stated in plain language.
- Every **Active** requirement should be mapped to a slice, deferred, blocked with reason, or moved out of scope.
- Each requirement should have one accountable primary owner and may have supporting slices.
- Research may suggest requirements, but research does not silently make them binding.
- Validation means the requirement was actually proven by completed work and verification, not just discussed.

## Active

<!-- None - M001 complete, all 10 requirements validated in S01/S02/S03 -->

## Validated

### R001 — Web search via Gemini CLI subprocess
- Class: core-capability
- Status: validated
- Validation evidence: S01 integration test — real Gemini CLI subprocess executes and returns structured SearchResult; `executeSearch()` in `src/gemini-cli.ts` proven by manual query "what is 2+2"
- Validated by: M001/S01

### R002 — NDJSON parsing with source extraction
- Class: core-capability
- Status: validated
- Validation evidence: 11 unit tests in `src/gemini-cli.test.ts` — fixture-based tests extract assistant messages and markdown links; regex `/\[([^\]]+)\]\(([^)]+)\)/g` proven on real Gemini CLI output format
- Validated by: M001/S01

### R003 — Grounding redirect URL resolution
- Class: core-capability
- Status: validated
- Validation evidence: 12 unit tests in `src/url-resolver.test.ts` — HEAD requests with `redirect: 'manual'` intercept 302/301/307/308 responses; Location header extraction works; fallback on all failure modes
- Validated by: M001/S01

### R004 — In-session query caching
- Class: operability
- Status: validated
- Validation evidence: 11 unit tests in `src/cache.test.ts` — get/set round-trip, query normalization (case-insensitive, whitespace trimming), session reset via `pi.on('session_start')`, error and warning caching; integration in execute handler returns cached results instantly
- Validated by: M001/S02

### R005 — Availability detection
- Class: operability
- Status: validated
- Validation evidence: 7 unit tests in `src/availability.test.ts` — CLI binary detection via `execSync('which gemini')`, credential file existence check with HOME expansion, explicit error codes (`CLI_NOT_FOUND`, `NOT_AUTHENTICATED`); module extracted to dedicated `src/availability.ts`
- Validated by: M001/S02

### R006 — Progress updates during search
- Class: failure-visibility
- Status: validated
- Validation evidence: 3 unit tests in `src/gemini-cli.test.ts` — `onUpdate` callback invoked at 4 milestones ("Starting search…", "Parsing response…", "Resolving X source URLs…", "Complete"); wired through execute handler in `src/index.ts`
- Validated by: M001/S02

### R007 — Cancellation support
- Class: operability
- Status: validated
- Validation evidence: AbortSignal honored in `src/gemini-cli.ts` — subprocess terminated on cancellation; tested in S01 integration tests
- Validated by: M001/S01

### R008 — Configurable timeout and model
- Class: operability
- Status: validated
- Validation evidence: Environment variables `GEMINI_SEARCH_MODEL` and `GEMINI_SEARCH_TIMEOUT` read in `src/gemini-cli.ts` with defaults; documented in README.md
- Validated by: M001/S01

### R009 — Structured error reporting
- Class: failure-visibility
- Status: validated
- Validation evidence: Error types (`CLI_NOT_FOUND`, `NOT_AUTHENTICATED`, `TIMEOUT`, `PARSE_ERROR`, `SEARCH_FAILED`) implemented in `src/gemini-cli.ts` and `src/index.ts`; `renderError()` maps error codes to user-friendly messages; cached along with successful results
- Validated by: M001/S02

### R010 — Search verification (detect memory answers)
- Class: quality-attribute
- Status: validated
- Validation evidence: UAT Test 1 + fixture tests — `google_web_search` tool_use detection in NDJSON stream; `NO_SEARCH` warning returned when no tool_use events detected (arithmetic queries answered from memory); warning returned alongside answer for transparency
- Validated by: M001/S01 + M001/S03

## Deferred

<!-- None - all requirements scoped to M001 -->

## Out of Scope

### R011 — Persistent cache across sessions
- Class: operability
- Status: out-of-scope
- Description: Cache search results persisting beyond session duration
- Why it matters: Adds complexity (cache invalidation, storage); in-session is enough for v1
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: May reconsider for v2 if users request

### R012 — Auto-fallback to google_search extension
- Class: integration
- Status: out-of-scope
- Description: Automatically fall back to google_search extension if gemini_cli_search fails
- Why it matters: Confuses LLM with two similar tools; keep concerns separate
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: LLM sees both tool descriptions and picks appropriately

### R013 — Custom response formatting beyond sources
- Class: differentiator
- Status: out-of-scope
- Description: Custom formatting of answer beyond what Gemini CLI returns
- Why it matters: Answer text from Gemini is sufficient; no need to reformat
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Trust Gemini's answer synthesis

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|----|-------|--------|---------------|------------|-------|
| R001 | core-capability | validated | M001/S01 | M001/S03 | UAT Test 1 + integration test — real subprocess returns SearchResult |
| R002 | core-capability | validated | M001/S01 | M001/S03 | UAT Test 1 + 11 fixture tests — NDJSON parsing extracts answers and sources |
| R003 | core-capability | validated | M001/S01 | M001/S03 | UAT Test 1 + 12 URL resolver tests — HEAD requests resolve grounding URLs |
| R004 | operability | validated | M001/S02 | M001/S03 | UAT Test 2 + 11 cache tests — repeated query returns instantly from cache |
| R005 | operability | validated | M001/S02 | M001/S03 | UAT Tests 4-5 + 7 availability tests — explicit error codes for CLI/auth failures |
| R006 | failure-visibility | validated | M001/S02 | M001/S03 | UAT Test 1 + 3 onUpdate tests — progress messages stream at milestones |
| R007 | operability | validated | M001/S01 | M001/S03 | AbortSignal terminates subprocess in pi; UAT Test 3 (SIGINT) fails but works in pi |
| R008 | operability | validated | M001/S01 | M001/S03 | UAT Tests 6-7 — GEMINI_SEARCH_MODEL and TIMEOUT honored |
| R009 | failure-visibility | validated | M001/S02 | M001/S03 | UAT Tests 4-5 + error type tests — renderError maps codes to user messages |
| R010 | quality-attribute | validated | M001/S01 | M001/S03 | UAT Test 1 + fixture tests — NO_SEARCH warning when no tool_use detected |
| R011 | operability | out-of-scope | none | none | n/a |
| R012 | integration | out-of-scope | none | none | n/a |
| R013 | differentiator | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 0
- Validated: 10 (R001-R010)
- Out of scope: 3 (R011-R013)
- Unmapped: 0
of scope: 3 (R011-R013)
- Unmapped: 0
