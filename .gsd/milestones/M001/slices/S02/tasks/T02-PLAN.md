# T02: Availability Detection Module — Plan

**Description:** Extract availability detection logic from `src/index.ts` into dedicated `src/availability.ts` module for clarity, reusability, and testability.

## Must-Haves

- `export function checkAvailability(): { available: boolean; reason?: string }` — full check with reason
- `export function isAvailable(): boolean` — simple boolean check
- Check CLI binary presence via `execSync('which gemini', { stdio: 'ignore' })`
- Check credential file presence via `fs.existsSync('~/.gemini/oauth_creds.json')`
- Expand `~` in home directory path correctly
- Tests cover: CLI present + creds present (available), CLI missing, creds missing, both missing

## Files

- `src/availability.ts` (new)
- `src/availability.test.ts` (new)
- `src/index.ts` (modify — import and use availability module)

## Steps

1. **Create `src/availability.ts`:**
   - Import `execSync` from 'child_process'
   - Import `existsSync` and `expandTilde` (or implement tilde expansion) from 'fs'/'path'
   - Implement `checkCliBinary(): boolean` — try `which gemini`, catch errors
   - Implement `checkCredentialFile(): boolean` — check `~/.gemini/oauth_creds.json`
   - Implement `checkAvailability(): { available: boolean; reason?: string }`:
     - If CLI missing: return `{ available: false, reason: 'CLI_NOT_FOUND' }`
     - If creds missing: return `{ available: false, reason: 'NOT_AUTHENTICATED' }`
     - If both present: return `{ available: true }`
   - Implement `isAvailable(): boolean` — wrapper that returns just the boolean
   - Export all functions

2. **Create `src/availability.test.ts`:**
   - Mock `execSync` and `existsSync` for testing
   - Test: CLI present + creds present → `available: true`
   - Test: CLI missing → `available: false, reason: 'CLI_NOT_FOUND'`
   - Test: Creds missing → `available: false, reason: 'NOT_AUTHENTICATED'`
   - Test: Both missing → `available: false, reason: 'CLI_NOT_FOUND'` (CLI checked first)
   - Test: `isAvailable()` returns correct boolean

3. **Update `src/index.ts`:**
   - Remove inline `checkAvailability()` function
   - Import `checkAvailability, isAvailable` from `./availability`
   - Update tool registration to use imported `checkAvailability()`
   - Keep console log on `session_start` but call imported function

## Verification

- `npx tsc --noEmit` — 0 TypeScript errors
- `npm test -- availability.test.ts` — 5 tests pass
- Manual: Run pi agent, verify tool registers correctly (no regression from S01)

## Inputs

- S01 implementation: `checkAvailability()` function in `src/index.ts` (lines 23-48)
- Node.js: `child_process.execSync`, `fs.existsSync`

## Expected Output

- `src/availability.ts` — ~40 lines, 4 exported functions
- `src/availability.test.ts` — ~80 lines, 5 passing tests
- Updated `src/index.ts` — imports from availability module, no inline check

## Observability Impact

- **No new signals** — availability detection remains the same
- **Failure visibility:** Error reasons now explicit strings (`'CLI_NOT_FOUND'`, `'NOT_AUTHENTICATED'`) — easier to extend in future
