# S03: Verification & Integration — Plan

**Goal:** Verify all 10 requirements (R001-R010) via manual UAT execution and create summary documentation proving production readiness.

**Demo:** Execute all 7 UAT test cases from S02-SUMMARY.md with documented pass/fail results and validation evidence for each requirement.

## Must-Haves

- All 7 UAT test cases executed and documented
- Extension registration verified (tool appears in pi)
- S03-SUMMARY.md created with validation evidence
- REQUIREMENTS.md updated with validated status for R001-R010

## Proof Level

- This slice proves: **integration + operational**
- Real runtime required: **yes** (Gemini CLI subprocess, OAuth credentials)
- Human/UAT required: **yes** (7 manual test cases)

## Verification

- **UAT execution:** All 7 test cases from `.gsd/milestones/M001/slices/S02/S02-UAT.md` executed with pass/fail documented
- **Extension registration:** `gemini_cli_search` tool visible in pi's available tools
- **TypeScript compilation:** `npx tsc --noEmit` — 0 errors
- **Unit tests:** `npm test` — 64 tests pass (no new tests added, verifying existing suite still passes)

## Observability / Diagnostics

- Runtime signals: Console logs for cache hits, availability checks, progress messages
- Inspection surfaces: UAT test results in S02-UAT.md, S03-SUMMARY.md validation matrix
- Failure visibility: Error codes (`CLI_NOT_FOUND`, `NOT_AUTHENTICATED`, `TIMEOUT`, etc.) distinguish failure modes
- Redaction constraints: OAuth credentials not logged; only file presence checked

## Integration Closure

- Upstream surfaces consumed: `src/index.ts` (extension entry), `src/gemini-cli.ts` (subprocess execution), `src/cache.ts`, `src/availability.ts`, `src/url-resolver.ts`
- New wiring introduced in this slice: **none** (verification only, no code changes)
- What remains before the milestone is truly usable end-to-end: **nothing** (S03 completes M001)

## Tasks

- [ ] **T01: Execute UAT tests and document results** `est:2h`
  - Why: All 10 requirements need runtime verification with real Gemini CLI and OAuth credentials; 64 unit tests prove code paths but not end-to-end functionality
  - Files: `.gsd/milestones/M001/slices/S02/S02-UAT.md`, `.gsd/worktrees/M001/.gsd/milestones/M001/slices/S03/S03-UAT-RESULTS.md`
  - Do:
    1. Verify prerequisites: `gemini --version` works, `~/.gemini/oauth_creds.json` exists
    2. Execute each of the 7 UAT test cases sequentially
    3. For each test case: record pass/fail, actual output, execution time, any errors
    4. For Test 1 (first query): verify answer text + resolved source URLs + progress messages + search verification warning (if applicable)
    5. For Test 2 (repeated query): verify instant response (no subprocess, cache hit log visible)
    6. For Test 3 (cancellation): verify subprocess terminates, no orphan processes
    7. For Tests 4-5 (missing CLI/auth): verify correct error codes and messages
    8. For Tests 6-7 (custom model/timeout): verify environment variables honored
    9. Write results to `S03-UAT-RESULTS.md` with pass/fail status per test
  - Verify: All 7 tests documented with actual output; at least 6/7 pass ( Test 3 cancellation may be environment-dependent)
  - Done when: S03-UAT-RESULTS.md exists with complete test execution records

- [ ] **T02: Create summary and update requirements** `est:1h`
  - Why: M001 completion requires all requirements marked as validated with evidence; S03-SUMMARY.md provides the validation contract
  - Files: `.gsd/milestones/M001/slices/S03/S03-SUMMARY.md`, `.gsd/REQUIREMENTS.md`
  - Do:
    1. Run `npm test` to confirm 64 tests still pass
    2. Run `npx tsc --noEmit` to confirm 0 type errors
    3. Create S03-SUMMARY.md with:
       - What happened (UAT execution summary)
       - Verification results (test counts, compilation status)
       - Requirements validated (R001-R010 with evidence pointers to UAT results)
       - Known limitations (from S02-SUMMARY.md forward intelligence)
       - Files created/modified
    4. Update REQUIREMENTS.md:
       - Move R001-R010 from "Active" to "Validated" section
       - Add validation evidence: "UAT Test N passed — <brief description>"
       - Update traceability table with proof column
    5. Update S03-PLAN.md: mark both tasks as complete with checkboxes
  - Verify: REQUIREMENTS.md shows all 10 requirements as validated; S03-SUMMARY.md exists with complete validation matrix
  - Done when: Both files updated and committed; milestone M001 ready for merge

## Files Likely Touched

- `.gsd/milestones/M001/slices/S03/S03-UAT-RESULTS.md` (new)
- `.gsd/milestones/M001/slices/S03/S03-SUMMARY.md` (new)
- `.gsd/milestones/M001/slices/S03/S03-PLAN.md` (update checkboxes)
- `.gsd/REQUIREMENTS.md` (update requirement status)
