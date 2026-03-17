# T01: Define Shared Types

## Description

Define TypeScript interfaces for all shared types used across the extension. This is the foundation that unblocks all other modules.

## Steps

1. Create `src/types.ts` with the following interfaces:
   - `SearchResult` — Complete search result with answer, sources, warnings, errors
   - `GroundingUrl` — Original redirect URL and resolved actual URL
   - `SearchWarning` — Warning type for memory answers
   - `SearchError` — Structured error with type and message
   - `SearchOptions` — Configuration options (model, timeout, signal)

2. Export all types from the module

3. Create `src/types.test.ts` with basic type validation tests

4. Verify TypeScript compilation succeeds

## Must-Haves

- `SearchResult` includes: `answer: string`, `sources: GroundingUrl[]`, `warning?: SearchWarning`, `error?: SearchError`
- `GroundingUrl` includes: `original: string`, `resolved: string`, `resolvedSuccessfully: boolean`
- `SearchWarning` includes: `type: 'NO_SEARCH'`, `message: string`
- `SearchError` includes: `type: 'CLI_NOT_FOUND' | 'NOT_AUTHENTICATED' | 'TIMEOUT' | 'PARSE_ERROR' | 'SEARCH_FAILED'`, `message: string`
- `SearchOptions` includes: `model?: string`, `timeout?: number`, `signal?: AbortSignal`
- All types exported from module

## Verification

- `npx tsc --noEmit` — No TypeScript errors
- `npm test -- types.test.ts` — Type tests pass

## Inputs

- Requirement contract from REQUIREMENTS.md (R001-R003, R009-R010)
- Decision register (D001-D006, D009, D011)

## Expected Output

- `src/types.ts` — 80-100 lines, defines and exports all shared types
- `src/types.test.ts` — 30-40 lines, validates type structure
- TypeScript compilation succeeds with no errors

## Observability Impact

None - types are compile-time only, no runtime behavior.
