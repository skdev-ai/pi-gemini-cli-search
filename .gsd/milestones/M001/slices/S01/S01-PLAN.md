# S01: Core Search Functionality

**Goal:** User can invoke `gemini_cli_search` tool and receive AI-synthesized answers with resolved source URLs, with search verification warnings when Gemini answers from memory.

**Demo:** Execute extension tool with query "latest TypeScript version", receive answer with resolved source URLs (not opaque vertexaisearch URLs), warning present if Gemini didn't search.

## Must-Haves

- Spawn Gemini CLI subprocess with correct flags (`-o stream-json -p "<prompt>" --yolo`)
- Parse NDJSON output line-by-line, extract assistant message and detect `google_web_search` tool_use events
- Resolve grounding redirect URLs via HEAD requests with fallback on failure
- Return structured result with answer, resolved sources, and optional warning
- Tool registers with pi extension API with TypeBox schema

## Proof Level

- This slice proves: **integration**
- Real runtime required: **yes**
- Human/UAT required: **yes**

## Verification

- `npm test` — Unit tests for NDJSON parsing and URL resolution pass
- `node --test src/**/*.test.ts` — All test files pass
- Manual test: Run extension with query "what is pi agent", verify answer has resolved URLs
- Integration test: Execute real Gemini CLI subprocess, verify parsing extracts sources correctly
- **Failure path verification:** Run with non-existent CLI binary or timeout=1, verify `SearchResult.error` contains structured `SearchError` with type `CLI_NOT_FOUND` or `TIMEOUT`

## Observability / Diagnostics

- Runtime signals: Structured error types with machine-distinguishable categories
- Inspection surfaces: Console logs during development, structured return values
- Failure visibility: Error messages distinguish "CLI not found", "parse error", "URL resolution failed"
- Redaction constraints: No secrets logged (OAuth tokens, API keys)

## Integration Closure

- Upstream surfaces consumed: pi extension API (`registerTool`), Node.js `child_process.spawn`, native `fetch()`
- New wiring introduced in this slice: Tool execution flow from pi → extension → subprocess → parser → URL resolver → response
- What remains before the milestone is truly usable end-to-end: Caching, availability detection, progress streaming, cancellation, environment config (S02)

## Tasks

- [x] **T01: Define shared types** `est:15m`
  - Why: All other modules depend on these types; defines the contract for SearchResult, GroundingUrl, SearchWarning, SearchError
  - Files: `src/types.ts`, `src/types.test.ts`
  - Do: Define TypeScript interfaces for all shared types; export from module; add basic type tests
  - Verify: `npm test -- types.test.ts` passes; TypeScript compilation succeeds
  - Done when: Types compile, are exported, and test file validates type structure

- [x] **T02: Implement URL resolver** `est:45m`
  - Why: Grounding redirect URLs must be resolved to actual domains; isolated function that's easy to test independently
  - Files: `src/url-resolver.ts`, `src/url-resolver.test.ts`
  - Do: Implement `resolveGroundingUrls(urls: string[]): Promise<string[]>` using fetch() with redirect: "manual"; extract Location header; fallback to URL as-is on failure; add unit tests with mocked fetch
  - Verify: `npm test -- url-resolver.test.ts` passes; test covers success (302 redirect) and failure (network error, non-302) cases
  - Done when: URL resolver handles redirects, fallbacks, and all tests pass

- [x] **T03: Implement Gemini CLI subprocess execution and parsing** `est:90m`
  - Why: Core riskiest functionality - proves NDJSON parsing works and search verification detects memory answers
  - Files: `src/gemini-cli.ts`, `src/gemini-cli.test.ts`, `src/fixtures/` (NDJSON test fixtures)
  - Do: Implement `executeSearch(query: string, options: SearchOptions): Promise<SearchResult>` using child_process.spawn(); parse NDJSON line-by-line; extract assistant message; detect google_web_search tool_use events; parse markdown links from text; call url-resolver; assemble SearchResult with warning if no search detected; add tests with recorded NDJSON fixtures
  - Verify: `npm test -- gemini-cli.test.ts` passes; manual test with real Gemini CLI returns parsed result
  - Done when: Subprocess spawns, NDJSON parses, sources extract, URLs resolve, search verification works

- [ ] **T04: Register tool with pi extension API** `est:60m`
  - Why: Makes the functionality available to pi agent; wires all modules together
  - Files: `src/index.ts`, `src/index.test.ts`
  - Do: Follow jmunch-enforcer pattern for tool registration; define TypeBox schema for tool parameters; implement execute() handler calling gemini-cli; implement render functions for answer and error states; add promptGuidelines to help LLM choose tool correctly; export extension entry point
  - Verify: Extension compiles; TypeScript no errors; manual load test in pi agent shows tool in tool list
  - Done when: Tool registers, compiles, and can be invoked from pi agent

## Files Likely Touched

- `src/types.ts`
- `src/url-resolver.ts`
- `src/gemini-cli.ts`
- `src/index.ts`
- `src/types.test.ts`
- `src/url-resolver.test.ts`
- `src/gemini-cli.test.ts`
- `src/index.test.ts`
- `src/fixtures/` (NDJSON test fixtures)
- `package.json` (test script, if not present)
- `tsconfig.json` (if not present)
