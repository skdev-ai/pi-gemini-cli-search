# M001: Gemini CLI Search Extension

**Gathered:** 2026-03-16
**Status:** Ready for planning

## Project Description

A pi (GSD-2) extension that enables web search capabilities by spawning the Gemini CLI binary as a subprocess. Users with Google AI Pro subscriptions authenticated via Gemini CLI can leverage their existing OAuth credentials — no separate API key required.

## Why This Milestone

Users with Google AI Pro subscriptions authenticated via Gemini CLI cannot use their subscription for search in GSD-2's existing `google_search` extension because:
1. That extension requires a separate `GEMINI_API_KEY`
2. Using OAuth tokens from Gemini CLI directly in third-party code violates Google's ToS
3. Google only permits Gemini CLI and Antigravity IDE to use OAuth bearer tokens

This milestone solves the problem by spawning `gemini` CLI as a subprocess — the CLI uses its own OAuth credentials natively, no ToS violation.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Invoke `gemini_cli_search` tool from pi agent to search the web
- Receive AI-synthesized answers grounded in Google Search results
- See clean source URLs (not opaque redirect URLs)
- Get warnings if Gemini answered from memory instead of searching

### Entry point / environment

- Entry point: pi agent tool call — `gemini_cli_search(query: string, maxSources?: number)`
- Environment: Local development, pi agent running in terminal
- Live dependencies involved: `gemini` CLI binary, Google web search via Gemini

## Completion Class

- Contract complete means: All 10 active requirements verified by tests and artifacts
- Integration complete means: Extension registers with pi, subprocess executes, NDJSON parses, URLs resolve
- Operational complete means: Extension handles errors, caches queries, detects availability, streams progress

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- User can invoke `gemini_cli_search` from pi agent and receive a working answer with sources
- Grounding redirect URLs are resolved to actual domains (e.g., `github.com`, `stackoverflow.com`)
- Search verification warns when Gemini answers from memory (no `google_web_search` tool_use event)
- Repeated identical queries return cached results (no subprocess execution)
- Clear error when `gemini` CLI is not installed or not authenticated

## Risks and Unknowns

- **NDJSON format changes** — Gemini CLI may change output format; parsing is brittle
- **Redirect URL expiration** — Grounding redirect URLs may expire before HEAD request completes
- **Auth token expiry** — We detect credential file presence, not token validity; runtime errors must handle this
- **Prompt reliability** — Prompt instructs Gemini to search but doesn't force it; verification catches failures but doesn't prevent them

## Existing Codebase / Prior Art

- `RESEARCH-gemini-cli-search-extension.md` — Full technical research and architecture
- CCS `websearch-transformer.cjs` — Proven prompt template and subprocess pattern
- GSD-2 `google_search` extension — Existing pi extension pattern, caching strategy
- `jmunch-enforcer` extension — Local extension example structure

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R001-R010 — All active requirements owned by M001
- R011-R013 — Explicitly out of scope for this milestone

## Scope

### In Scope

- pi extension tool registration with TypeBox schema
- Subprocess spawn and NDJSON parsing
- Grounding redirect URL resolution via HEAD requests
- Search verification (detect memory answers)
- In-session query caching
- Availability detection (CLI presence + credential file)
- Progress updates and cancellation support
- Configurable timeout and model via environment variables
- Structured error reporting
- Tool description and promptGuidelines for LLM disambiguation

### Out of Scope / Non-Goals

- Persistent cache across sessions
- Auto-fallback to google_search extension
- Custom response formatting beyond what Gemini returns
- Forcing Gemini to search (API's `tools: [{ googleSearch: {} }]` pattern not available via CLI)

## Technical Constraints

- Must use Gemini CLI subprocess — cannot call Gemini API directly (ToS violation)
- Must parse NDJSON from stdout — no structured grounding metadata available
- Must resolve redirect URLs — sources baked into markdown links, not separate metadata
- Extension must work with pi's extension API — TypeBox schemas, execute signature, render functions

## Integration Points

- **pi extension API** — `registerTool()`, `onUpdate` streaming, cancellation signal
- **gemini CLI binary** — subprocess execution with `-o stream-json -p "<prompt>" --yolo -m <model>`
- **Google grounding redirect URLs** — HEAD requests to resolve `vertexaisearch.cloud.google.com/grounding-api-redirect/...`
- **~/.gemini/oauth_creds.json** — Credential file for availability detection

## Open Questions

- **Retry strategy for failed searches** — If verification detects memory answer, should we retry automatically or just warn? (Decision: warn only, let LLM decide)
- **Cache key normalization** — How to normalize queries for cache key? (Decision: lowercase, trim whitespace, consistent ordering)
- **Timeout default** — 60s default from CCS, but is this appropriate? (Decision: use CCS default, adjust based on user feedback)
