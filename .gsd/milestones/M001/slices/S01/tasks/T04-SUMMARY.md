---
id: T04
parent: S01
milestone: M001
provides:
  - Tool registration with pi extension API
  - TypeBox schema for tool parameters
  - Availability check before execution
  - Structured answer and error rendering
key_files:
  - src/index.ts
  - src/index.test.ts
  - src/types-external.d.ts
key_decisions:
  - Used TypeBox for runtime parameter validation
  - Created type declaration file for @gsd/pi-coding-agent module
  - Added @sinclair/typebox as dependency
patterns_established:
  - Tool registration follows jmunch-enforcer pattern
  - Availability check before execution to fail fast
  - Structured error messages with machine-distinguishable types
  - renderAnswer/renderError separation for clean output
observability_surfaces:
  - Console logs on session_start for availability status
  - Structured error types in renderError output
  - Tool appears in pi agent tool list with description and promptGuidelines
duration: 45m
verification_result: passed
completed_at: 2026-03-16T23:09:16Z
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# T04: Register Tool with pi Extension API

**Registered gemini_cli_search tool with pi extension API, TypeBox schema validation, and comprehensive tests.**

## What Happened

The `src/index.ts` file already existed with a complete implementation. I verified it matched all must-haves, then:

1. **Added TypeBox dependency**: `npm install @sinclair/typebox`
2. **Created type declarations**: Added `src/types-external.d.ts` for `@gsd/pi-coding-agent` module (types provided by pi runtime, not npm)
3. **Created test file**: `src/index.test.ts` with 8 comprehensive tests covering:
   - Tool registration
   - TypeBox schema validation (valid and invalid inputs)
   - Prompt guidelines presence
   - Execute handler structure
   - Session event handler registration
   - Availability check logic
4. **Fixed TypeScript errors**: Added proper null checks and removed unused imports
5. **All tests pass**: 41 total tests across all test files

## Verification

- ✅ `npx tsc --noEmit` — No TypeScript errors
- ✅ `npm test` — All 41 tests pass (8 for index.test.ts)
- ✅ Tool structure verified: registers with correct name, schema, and handlers
- ✅ TypeBox schema validates `{ query: string }` correctly
- ✅ Availability check verifies `gemini` binary and OAuth credentials
- ✅ renderAnswer displays numbered source links with resolved URLs
- ✅ renderError displays structured error messages by type

## Diagnostics

- **Tool availability**: Check console logs on session_start for `[gemini-cli-search] Tool available/unavailable`
- **Error inspection**: Error messages include type (CLI_NOT_FOUND, NOT_AUTHENTICATED, TIMEOUT, PARSE_ERROR, SEARCH_FAILED) for programmatic handling
- **Tool presence**: Tool appears in pi agent tool list with description and prompt guidelines
- **Runtime behavior**: Execute handler checks availability before calling executeSearch(), returns structured content array

## Deviations

None. The existing implementation matched the task plan requirements.

## Known Issues

None.

## Files Created/Modified

- `src/index.ts` — Extension entry point with tool registration (170 lines, pre-existing)
- `src/index.test.ts` — Tool registration tests (156 lines, created)
- `src/types-external.d.ts` — Type declarations for pi extension API (created)
- `package.json` — Added @sinclair/typebox dependency (modified)
