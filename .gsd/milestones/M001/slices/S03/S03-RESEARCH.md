# S03: Verification & Integration — Research

**Date:** 2026-03-16

## Summary

S03 is the final verification slice for the Gemini CLI Search extension. All 10 requirements (R001-R010) have been implemented and validated by 64 unit tests across S01 and S02. This slice focuses on integration verification and manual UAT to prove the extension works end-to-end in a real pi environment.

**Primary recommendation:** Execute the 7 UAT test cases from S02-SUMMARY.md, document results, and create the S03-SUMMARY.md with validation evidence. No new code is required unless UAT reveals failures.

The extension is production-ready pending successful UAT execution. The main risks are environmental (Gemini CLI installation, authentication state) rather than code defects.

## Recommendation

**Approach:** Manual UAT execution with systematic documentation.

**Why this approach:**
1. **All unit tests pass** — 64 tests cover NDJSON parsing, URL resolution, caching, availability detection, progress streaming, and error handling
2. **TypeScript compiles cleanly** — No type errors
3. **Integration points are proven** — Subprocess execution, HEAD requests, cache integration all have fixture-based tests
4. **What's missing** — Runtime verification with actual Gemini CLI subprocess, real OAuth credentials, and pi extension loading

**Scope for S03:**
- Execute all 7 UAT test cases from S02-SUMMARY.md
- Verify extension loads in pi and registers `gemini_cli_search` tool
- Document validation evidence for each requirement (R001-R010)
- Create S03-SUMMARY.md with pass/fail results and known issues

**Out of scope:**
- New feature development
- Additional unit tests (unless UAT reveals gaps)
- Persistent cache (R011 - explicitly out of scope)

## Implementation Landscape

### Key Files

- `.gsd/milestones/M001/slices/S02/S02-UAT.md` — 7 manual test cases to execute
- `.gsd/milestones/M001/REQUIREMENTS.md` — Requirement coverage tracking (update with validation evidence)
- `src/index.ts` — Extension entry point; verify it loads in pi via manual inspection or test harness
- `src/gemini-cli.ts` — Subprocess execution; already proven by fixture tests
- `src/cache.ts`, `src/availability.ts`, `src/url-resolver.ts` — Supporting modules; all tested

### Build Order

This slice has no code to build — only verification to execute:

1. **Verify extension structure** — Check that `src/index.ts` exports default function with correct pi extension signature
2. **Execute UAT tests** — Run all 7 test cases from S02-SUMMARY.md
3. **Document results** — Update S02-UAT.md with pass/fail status and notes
4. **Create S03 summary** — Write S03-SUMMARY.md with validation evidence for each requirement
5. **Update REQUIREMENTS.md** — Mark all 10 requirements as validated with evidence pointers

### Verification Approach

**TypeScript compilation:**
```bash
npx tsc --noEmit
```
Expected: 0 errors (already verified)

**Unit tests:**
```bash
npm test
```
Expected: 64 tests pass (already verified)

**Manual UAT (7 test cases):**
1. First query returns answer with progress messages
2. Repeated query returns cached result (instant)
3. Cancel mid-search terminates subprocess
4. Missing CLI shows clear error
5. Missing auth shows clear error
6. Custom model via GEMINI_SEARCH_MODEL works
7. Custom timeout via GEMINI_SEARCH_TIMEOUT works

**Extension registration verification:**
- Load extension in pi (add to `~/.pi/agent/extensions/` or project `.gsd/extensions/`)
- Verify `gemini_cli_search` tool appears in available tools
- Execute a real search query and observe answer + sources

**Requirement validation mapping:**
- R001-R003 (core search) → UAT Test 1, 6, 7
- R004 (caching) → UAT Test 2
- R005 (availability) → UAT Test 4, 5
- R006 (progress) → UAT Test 1
- R007 (cancellation) → UAT Test 3
- R008 (config) → UAT Test 6, 7
- R009 (error reporting) → UAT Test 4, 5, 7
- R010 (search verification) → UAT Test 1 (check for warning when Gemini answers from memory)

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Extension testing | Manual UAT + existing unit tests | No test framework needed; 64 unit tests already cover all code paths |
| pi extension API | Use existing pattern from `jmunch-enforcer` | Same extension structure; no need to invent new registration pattern |

## Constraints

- **Gemini CLI must be installed** — `gemini --version` must work
- **OAuth authentication required** — `~/.gemini/oauth_creds.json` must exist
- **Google AI Pro subscription** — Required for Gemini CLI search functionality
- **pi agent environment** — Extension must load in pi's extension API context

## Common Pitfalls

- **OAuth token expiry** — Credential file may exist but token expired; runtime errors will distinguish this from missing credentials
- **Network connectivity** — URL resolution requires internet access for HEAD requests; failures will fallback gracefully but sources won't resolve
- **Model availability** — Custom model via `GEMINI_SEARCH_MODEL` must be available to the user's Gemini account
- **pi extension loading** — Extension must be in correct directory (`~/.pi/agent/extensions/` or `.gsd/extensions/`) and pi must be restarted

## Open Risks

- **pi extension API compatibility** — Extension follows documented pattern but hasn't been loaded in actual pi environment yet; may need minor adjustments
- **Grounding URL TTL** — Redirect URLs may expire before HEAD request completes; fallback logic exists but sources may remain unresolved
- **NDJSON format stability** — Gemini CLI could change output format; fixture tests assume stable schema

## Sources

- `.gsd/milestones/M001/slices/S02/S02-SUMMARY.md` — S02 implementation details and forward intelligence
- `.gsd/milestones/M001/slices/S02/S02-UAT.md` — Manual test cases
- `.gsd/REQUIREMENTS.md` — Requirement coverage tracking
- `src/index.ts`, `src/gemini-cli.ts` — Extension implementation
