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

### R001 — Web search via Gemini CLI subprocess
- Class: core-capability
- Status: active
- Description: Spawn `gemini -o stream-json -p "<prompt>" --yolo -m gemini-2.5-flash` as subprocess, return structured results
- Why it matters: Core functionality - enables search without API key, uses user's Gemini CLI OAuth
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: none
- Validation: unmapped
- Notes: Uses `-p` flag for headless mode, `--yolo` for auto-accept tool calls

### R002 — NDJSON parsing with source extraction
- Class: core-capability
- Status: active
- Description: Parse Gemini CLI's stream-json output, concatenate assistant message chunks, extract markdown links from text content
- Why it matters: Gemini CLI doesn't provide structured grounding metadata - sources are baked into assistant text as markdown links
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: none
- Validation: unmapped
- Notes: Sources parsed from text, not from structured metadata

### R003 — Grounding redirect URL resolution
- Class: core-capability
- Status: active
- Description: HEAD request each `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URL to extract actual source domain via Location header; fallback to using redirect URL as-is if resolution fails
- Why it matters: Without resolution, users only see opaque redirect URLs, not actual source domains
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: none
- Validation: unmapped
- Notes: Graceful degradation - if HEAD fails or returns non-302, use URL as-is

### R004 — In-session query caching
- Class: operability
- Status: active
- Description: Cache search results keyed by normalized query for session duration
- Why it matters: Repeated identical queries are free; proven pattern from existing google_search extension
- Source: inferred
- Primary owning slice: M001/S02
- Supporting slices: none
- Validation: unmapped
- Notes: TTL = session duration; normalize query for cache key

### R005 — Availability detection
- Class: operability
- Status: active
- Description: Check if `gemini` CLI binary exists and `~/.gemini/oauth_creds.json` credential file exists before registering tool; detect presence, not token validity
- Why it matters: Don't expose unavailable tool to LLM; clear error messages; actual auth failures surface at runtime
- Source: research
- Primary owning slice: M001/S02
- Supporting slices: none
- Validation: unmapped
- Notes: Token may be expired - runtime errors distinguish auth failures

### R006 — Progress updates during search
- Class: failure-visibility
- Status: active
- Description: Stream progress via `onUpdate` during subprocess execution
- Why it matters: Search duration varies (typically ~10 seconds) - needs visibility to user
- Source: inferred
- Primary owning slice: M001/S02
- Supporting slices: none
- Validation: unmapped
- Notes: Use extension's onUpdate callback for streaming

### R007 — Cancellation support
- Class: operability
- Status: active
- Description: Honor abort signal to terminate subprocess early
- Why it matters: User should be able to cancel long-running searches
- Source: inferred
- Primary owning slice: M001/S02
- Supporting slices: none
- Validation: unmapped
- Notes: Check signal.aborted, terminate subprocess on cancellation

### R008 — Configurable timeout and model
- Class: operability
- Status: active
- Description: Environment variables `GEMINI_SEARCH_MODEL` (default: `gemini-2.5-flash`) and `GEMINI_SEARCH_TIMEOUT` (default: 60s)
- Why it matters: Flexibility for different models and timeout preferences
- Source: user
- Primary owning slice: M001/S02
- Supporting slices: none
- Validation: unmapped
- Notes: Follow CCS conventions for env var naming

### R009 — Structured error reporting
- Class: failure-visibility
- Status: active
- Description: Return clear error messages distinguishing "CLI not found", "not authenticated", "timeout", "search failed"
- Why it matters: LLM needs to understand what went wrong and communicate to user
- Source: inferred
- Primary owning slice: M001/S02
- Supporting slices: none
- Validation: unmapped
- Notes: Error types should be machine-distinguishable

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

### R010 — Search verification (detect memory answers)
- Class: quality-attribute
- Status: validated
- Validation evidence: Fixture tests detect `google_web_search` tool_use events; `NO_SEARCH` warning returned when absent; manual test with arithmetic query returns warning as expected
- Validated by: M001/S01

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
| R001 | core-capability | validated | M001/S01 | none | integration test + manual query |
| R002 | core-capability | validated | M001/S01 | none | 11 fixture-based unit tests |
| R003 | core-capability | validated | M001/S01 | none | 12 URL resolver tests |
| R004 | operability | active | M001/S02 | none | unmapped |
| R005 | operability | active | M001/S02 | none | unmapped |
| R006 | failure-visibility | active | M001/S02 | none | unmapped |
| R007 | operability | active | M001/S02 | none | unmapped |
| R008 | operability | active | M001/S02 | none | unmapped |
| R009 | failure-visibility | active | M001/S02 | none | unmapped |
| R010 | quality-attribute | validated | M001/S01 | none | fixture tests + manual query |
| R011 | operability | out-of-scope | none | none | n/a |
| R012 | integration | out-of-scope | none | none | n/a |
| R013 | differentiator | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 6
- Mapped to slices: 10
- Validated: 4 (R001, R002, R003, R010)
- Unmapped active requirements: 0
