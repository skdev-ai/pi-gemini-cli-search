# M001: Gemini CLI Search Extension

**Vision:** A pi extension that enables web search via Gemini CLI subprocess, allowing users with Google AI Pro subscriptions to leverage their existing OAuth credentials — no separate API key required.

## Success Criteria

- User can invoke `gemini_cli_search` tool from pi agent and receive working answers with source URLs
- Grounding redirect URLs are resolved to actual domains (not opaque `vertexaisearch.cloud.google.com` URLs)
- Search verification detects and warns when Gemini answers from memory
- Repeated identical queries return cached results without subprocess execution
- Clear error messages distinguish "CLI not found", "not authenticated", "timeout", "search failed"

## Key Risks / Unknowns

- **NDJSON format brittleness** — Gemini CLI may change output format; parsing assumes stable schema
- **Redirect URL TTL** — Grounding redirect URLs may expire before HEAD request completes
- **Prompt reliability** — Prompt instructs search but doesn't force it; verification catches but doesn't prevent failures
- **Auth token validity** — We detect credential file presence, not token validity; runtime must handle expired tokens

## Proof Strategy

- **NDJSON format brittleness** → retire in S01 by parsing real Gemini CLI output and testing with varied queries
- **Redirect URL TTL** → retire in S01 by implementing fallback (use URL as-is if HEAD fails)
- **Prompt reliability** → retire in S01 by implementing search verification that detects missing `google_web_search` tool_use events
- **Auth token validity** → retire in S02 by implementing structured error handling that distinguishes auth failures

## Verification Classes

- Contract verification: TypeScript compilation, ESLint, unit tests for NDJSON parsing and URL resolution
- Integration verification: Real subprocess execution with actual `gemini` CLI, real HEAD requests to grounding URLs
- Operational verification: Extension loads in pi, tool registers, availability detection works, caching prevents redundant calls
- UAT / human verification: Manual search queries to verify answer quality and source URL resolution

## Milestone Definition of Done

This milestone is complete only when all are true:

- All 3 slices are complete with passing tests
- Extension registers `gemini_cli_search` tool with pi's extension API
- Subprocess execution works end-to-end with real `gemini` CLI
- NDJSON parsing extracts answers and detects `google_web_search` tool_use events
- Grounding redirect URLs are resolved to actual domains (with fallback on failure)
- Search verification returns warnings when Gemini answers from memory
- In-session cache prevents redundant identical queries
- Availability detection checks CLI binary and credential file presence
- Progress updates stream during execution, cancellation terminates subprocess
- Environment variables `GEMINI_SEARCH_MODEL` and `GEMINI_SEARCH_TIMEOUT` are configurable
- Structured error messages distinguish failure modes
- Tool description and promptGuidelines help LLM choose correctly

## Requirement Coverage

- Covers: R001, R002, R003, R004, R005, R006, R007, R008, R009, R010
- Partially covers: none
- Leaves for later: none
- Orphan risks: none

## Slices

- [x] **S01: Core search functionality** `risk:high` `depends:[]`
  > After this: User can invoke `gemini_cli_search` tool and receive AI-synthesized answers with resolved source URLs, with search verification warnings when Gemini answers from memory.

- [x] **S02: Operability & resilience** `risk:medium` `depends:[S01]`
  > After this: Extension handles errors gracefully, caches repeated queries, detects availability, streams progress, and supports cancellation.

- [x] **S03: Verification & integration** `risk:low` `depends:[S02]`
  > After this: All requirements verified via integration tests and manual UAT; extension ready for production use.

## Boundary Map

### S01 → S02

Produces:
- `index.ts` — Extension entry with `gemini_cli_search` tool registration (TypeBox schema, execute handler, render functions, promptGuidelines)
- `gemini-cli.ts` — Subprocess spawn, NDJSON parsing, search verification, source extraction
- `url-resolver.ts` — `resolveGroundingUrls(urls: string[]): Promise<string[]>` with fallback on HEAD failure
- `types.ts` — Shared types: `SearchResult`, `GroundingUrl`, `SearchWarning`

Consumes:
- nothing (leaf node)

### S01 → S03

Produces:
- `index.ts` — Full tool registration with all fields
- `gemini-cli.ts` — Complete execute handler with search verification
- `url-resolver.ts` — URL resolution with graceful degradation

Consumes:
- nothing (direct dependency on S01 outputs)

### S02 → S03

Produces:
- `cache.ts` — In-session query cache with `get(query): SearchResult | undefined` and `set(query, result): void`
- `availability.ts` — `checkGeminiAvailability(): Promise<{ available: boolean, error?: string }>`
- Enhanced error handling in `gemini-cli.ts` with structured error types
- Environment variable configuration (`GEMINI_SEARCH_MODEL`, `GEMINI_SEARCH_TIMEOUT`)
- `onUpdate` progress streaming during subprocess execution

Consumes from S01:
- `gemini-cli.ts` — subprocess execution, NDJSON parsing
- `url-resolver.ts` — URL resolution function
- `types.ts` — Shared types
