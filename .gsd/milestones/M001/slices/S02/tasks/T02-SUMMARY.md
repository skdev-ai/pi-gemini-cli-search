---
id: T02
parent: S02
milestone: M001
provides:
  - Availability detection module with CLI binary and credential checks
  - Exported functions: checkCliBinary(), checkCredentialFile(), checkAvailability(), isAvailable()
  - 7 passing tests covering all availability scenarios
key_files:
  - src/availability.ts
  - src/availability.test.ts
  - src/index.ts
key_decisions:
  - Error reasons use simple string codes ('CLI_NOT_FOUND', 'NOT_AUTHENTICATED') instead of verbose messages - easier to extend and test
  - CLI check uses `execSync('which gemini', { stdio: 'ignore' })` - simpler than { stdio: 'pipe' } since output isn't needed
  - Home directory expansion relies on process.env.HOME - no tilde expansion library needed
patterns_established:
  - Module extraction for single-responsibility utilities
  - Check ordering: CLI binary checked before credentials (fail fast on missing dependency)
  - Boolean wrapper function (isAvailable) for simple checks, detailed function (checkAvailability) for error reporting
observability_surfaces:
  - Error reason strings returned from checkAvailability() are logged on session_start
  - No new runtime signals - availability detection behavior unchanged from S01
duration: 25m
verification_result: passed
completed_at: 2026-03-16T23:45:00Z
blocker_discovered: false
---

# T02: Availability Detection Module

**Extracted availability detection logic from src/index.ts into dedicated src/availability.ts module with 4 exported functions and 7 passing tests.**

## What Happened

1. **Created `src/availability.ts`** (58 lines):
   - `checkCliBinary()` - Uses `execSync('which gemini', { stdio: 'ignore' })` to verify CLI presence
   - `checkCredentialFile()` - Checks `~/.gemini/oauth_creds.json` existence with proper HOME expansion
   - `checkAvailability()` - Returns `{ available: boolean, reason?: string }` with explicit error codes
   - `isAvailable()` - Simple boolean wrapper around checkAvailability()

2. **Created `src/availability.test.ts`** (85 lines):
   - Tests for checkCliBinary, checkCredentialFile, checkAvailability, and isAvailable
   - Covers scenarios: CLI present + creds present, CLI missing, creds missing, both missing
   - Verifies CLI is checked before credentials (CLI_NOT_FOUND takes precedence)

3. **Updated `src/index.ts`**:
   - Removed inline `checkAvailability()` function (was lines 23-54)
   - Removed unused imports (`existsSync`, `execSync`)
   - Added import: `import { checkAvailability } from "./availability.js"`
   - No changes to usage - existing calls to checkAvailability() work unchanged

## Verification

- `npx tsc --noEmit` — 0 TypeScript errors ✓
- `npm test -- src/availability.test.ts` — 7 tests pass ✓
  - checkCliBinary: 1 test
  - checkCredentialFile: 1 test
  - checkAvailability: 4 tests
  - isAvailable: 1 test
- Full test suite: 60 tests pass (including all existing tests) ✓
- Manual verification: Module imports correctly in index.ts, no runtime errors

## Diagnostics

- Error reasons are now explicit string codes: `'CLI_NOT_FOUND'`, `'NOT_AUTHENTICATED'`
- These codes are used in `renderError()` to produce user-friendly messages
- No new console logs or runtime signals added - availability detection behavior unchanged from S01

## Deviations

None - implementation matches the task plan exactly.

## Known Issues

None.

## Files Created/Modified

- `src/availability.ts` — New module with 4 exported availability check functions (58 lines)
- `src/availability.test.ts` — Test suite with 7 passing tests (85 lines)
- `src/index.ts` — Modified to import checkAvailability from availability module (removed inline function, ~35 lines removed)
