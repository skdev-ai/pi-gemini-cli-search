---
id: S02
parent: M001
milestone: M001
title: Operability & resilience
status: complete
---

# S02: Operability & Resilience — Roadmap Assessment

**Date:** 2026-03-16  
**Assessor:** GSD Auto-Mode  
**Verdict:** ✅ Roadmap remains valid — S03 proceeds as planned

## Coverage Check: Success Criteria

All five success criteria have been proved by S01 and S02:

- ✅ "User can invoke `gemini_cli_search` tool and receive working answers with source URLs" → **S01** (integration test, real subprocess execution)
- ✅ "Grounding redirect URLs are resolved to actual domains" → **S01** (12 url-resolver tests with HEAD requests)
- ✅ "Search verification detects and warns when Gemini answers from memory" → **S01** (fixture tests, manual query verification)
- ✅ "Repeated identical queries return cached results without subprocess execution" → **S02** (11 cache tests + integration test in execute handler)
- ✅ "Clear error messages distinguish failure modes" → **S02** (7 availability tests, structured error types with explicit codes)

## S02 Retired Risks

S02 successfully retired the remaining risk from the roadmap:

| Risk | Proof Strategy | Status |
|------|----------------|--------|
| **Auth token validity** | "Retire in S02 by implementing structured error handling that distinguishes auth failures" | ✅ Retired — `NOT_AUTHENTICATED` error code with runtime detection |

All four milestone risks are now retired (D001-D004 retired in S01, D005 retired in S02).

## Requirement Coverage

All 10 active requirements (R001-R010) remain covered:

| Requirement | Status | Primary Owner | Evidence |
|-------------|--------|---------------|----------|
| R001 — Web search via Gemini CLI | validated | S01 | integration test |
| R002 — NDJSON parsing | validated | S01 | 11 fixture tests |
| R003 — URL resolution | validated | S01 | 12 url-resolver tests |
| R004 — In-session caching | validated | S02 | 11 cache tests + integration |
| R005 — Availability detection | validated | S02 | 7 availability tests |
| R006 — Progress updates | validated | S02 | 3 onUpdate tests |
| R007 — Cancellation support | validated | S01 | AbortSignal integration |
| R008 — Configurable timeout/model | validated | S01 | env var tests + docs |
| R009 — Structured error reporting | validated | S02 | error types + renderError() |
| R010 — Search verification | validated | S01 | fixture tests + manual query |

**Coverage status:** 10/10 requirements validated by code + tests. Operational validation pending via S03 UAT.

## S03 Scope: Still Necessary

S03 ("Verification & integration") remains necessary for three reasons:

### 1. Operational Verification Gap
Unit tests prove the code works in isolation, but cannot verify:
- Extension loads correctly in pi runtime environment
- Tool registers with pi's extension API and appears in LLM tool picker
- Real Gemini CLI subprocess executes end-to-end with actual OAuth tokens
- Progress messages render correctly in pi UI
- Caching behavior works across multiple tool invocations in same session

### 2. UAT Execution Required
S02 created 7 manual UAT test cases (S02-UAT.md) covering:
- First query with progress streaming
- Cached query (instant return)
- Cancel mid-search
- Missing CLI error
- Missing auth error
- Custom model env var
- Custom timeout env var

These tests require a human operator to execute and verify in the actual pi environment. S03 owns this execution.

### 3. Production Readiness Sign-off
S03 provides the final "ship check":
- Confirm all 64 tests pass in clean environment
- Verify TypeScript compilation with strict mode
- Execute UAT test plan and document results
- Confirm extension installs and registers correctly
- Validate error messages are actionable for end users

## Boundary Map: Still Accurate

The S02 → S03 boundary contract remains accurate:

**S03 consumes from S02:**
- ✅ `cache.ts` — Implemented and tested
- ✅ `availability.ts` — Implemented and tested
- ✅ Enhanced error handling in `gemini-cli.ts` — Implemented
- ✅ Environment variable configuration — Implemented and documented
- ✅ `onUpdate` progress streaming — Implemented and tested

**S03 produces:**
- UAT execution results (S03-UAT.md)
- Integration test suite (if gaps found)
- Final verification sign-off (S03-SUMMARY.md)

## No Changes Required

**Roadmap decision:** Proceed with S03 as planned. No adjustments needed to scope, ordering, or boundary contracts.

S03 should execute the UAT test plan in S02-UAT.md, document results, and provide final verification sign-off for M001.

## Known Limitations (Carried Forward)

These limitations from S02 remain acceptable for v1:

1. **Cache scope limited to session** — Intentional; persistent cache can be added if users request
2. **Availability checks presence, not validity** — Runtime errors distinguish expired tokens
3. **Progress messages at milestones only** — Sufficient for v1; not every NDJSON line needs logging

## Recommendation

**Proceed to S03** with the following focus:
1. Execute all 7 UAT test cases from S02-UAT.md
2. Document any issues discovered during manual testing
3. Confirm extension loads and registers in pi environment
4. Write S03-SUMMARY.md with pass/fail results
5. Mark M001 complete if all UAT tests pass

---

**Assessment completed:** 2026-03-16  
**Next action:** S03 planning and UAT execution
