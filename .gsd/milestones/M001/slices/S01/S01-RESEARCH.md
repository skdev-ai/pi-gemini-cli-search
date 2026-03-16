# S01: Core Search Functionality — Research

**Date:** 2026-03-16

## Summary

S01 delivers the core search capability: spawn Gemini CLI as subprocess, parse NDJSON output, extract answers and sources, resolve grounding redirect URLs, and verify search was actually triggered. This is high-risk because it involves parsing brittle NDJSON format, resolving opaque Google URLs, and detecting memory answers without structured metadata.

The approach follows proven patterns from CCS websearch-transformer.cjs and GSD-2's google_search extension. Four files needed: `index.ts` (tool registration), `gemini-cli.ts` (subprocess execution + parsing), `url-resolver.ts` (HEAD requests for URL resolution), `types.ts` (shared types).

## Recommendation

Build in this order:
1. **types.ts** — Define shared types first (SearchResult, GroundingUrl, SearchWarning) — unblocks all other files
2. **url-resolver.ts** — Isolated function, easy to test independently
3. **gemini-cli.ts** — Core subprocess logic (highest risk, proves NDJSON parsing works)
4. **index.ts** — Wire everything together with pi extension API (lowest risk, follows existing patterns)

This order proves the risky parts first (parsing, URL resolution) before integration. If NDJSON format has changed, we discover it immediately.

## Implementation Landscape

### Key Files

- `.gsd/worktrees/M001/src/index.ts` — Extension entry point with `registerTool()`, availability check, TypeBox schema, render functions
- `.gsd/worktrees/M001/src/gemini-cli.ts` — Subprocess spawn with `spawn()`, NDJSON line-by-line parsing, search verification, response assembly
- `.gsd/worktrees/M001/src/url-resolver.ts` — `resolveGroundingUrls(urls: string[])` using `fetch()` with `redirect: "manual"` to extract Location header
- `.gsd/worktrees/M001/src/types.ts` — Shared types: `SearchResult`, `GroundingUrl`, `SearchWarning`, `SearchError`

### Build Order

1. **types.ts** (15-20 lines) — Defines the contract for all other modules
2. **url-resolver.ts** (40-50 lines) — Pure function, no pi API dependencies, testable with mock URLs
3. **gemini-cli.ts** (120-150 lines) — Core logic: spawn, parse, verify, assemble. This is the riskiest file.
4. **index.ts** (80-100 lines) — Integration: follows jmunch-enforcer pattern for tool registration

### Verification Approach

**Unit tests (contract verification):**
- `url-resolver.test.ts` — Mock HEAD requests, test fallback behavior
- `gemini-cli.test.ts` — Parse recorded NDJSON fixtures, verify search detection

**Integration verification:**
- Run `gemini -o stream-json -p "test query" --yolo` manually, capture output
- Execute extension tool with test queries, verify sources resolved

**Operational verification:**
- Extension loads without errors
- Tool appears in pi agent tool list
- Availability check correctly detects missing CLI

## Don't Hand-Rail

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Subprocess execution | Node.js `child_process.spawn()` | Built-in, supports async streaming, cancellation via AbortSignal |
| HTTP HEAD requests | Native `fetch()` with `redirect: "manual"` | No dependency needed, handles redirect extraction cleanly |
| NDJSON parsing | Manual line-by-line with `JSON.parse()` | Simple enough that no library needed; each line is valid JSON |
| Markdown link extraction | Regex `/\[([^\]]+)\]\(([^)]+)\)/g` | Gemini bakes sources into text; regex is sufficient and fast |
| TypeBox schemas | `@sinclair/typebox` | pi extension API requires this for tool parameter validation |

## Constraints

- **Gemini CLI subprocess only** — Cannot call Gemini API directly (ToS violation for OAuth tokens)
- **NDJSON from stdout** — No structured grounding metadata; sources embedded in assistant text as markdown links
- **pi extension API signature** — Must use `registerTool()` with TypeBox schema, `execute()` with specific signature
- **--yolo flag required** — Auto-accept tool calls; user already authenticated via Gemini CLI
- **Credential file location** — `~/.gemini/oauth_creds.json` for availability detection (not token validity)

## Common Pitfalls

- **NDJSON parsing assumes stable format** — If Gemini CLI changes event structure, parsing breaks. Mitigation: test with varied queries, watch for parsing errors
- **Redirect URL TTL** — Grounding URLs may expire before HEAD request. Mitigation: fallback to URL as-is if HEAD fails
- **Gemini answers from memory** — Prompt instructs search but doesn't force it. Mitigation: search verification detects missing `google_web_search` event, returns warning
- **Subprocess timeout** — Search takes ~10s. Mitigation: use 60s default timeout, honor abort signal for cancellation

## Open Risks

- **Gemini CLI version differences** — User may have older/newer version with different CLI flags or NDJSON schema
- **Prompt injection via query** — User query goes directly into prompt; Gemini may interpret maliciously. Mitigation: CCS uses simple prompt structure, no complex instructions
- **Concurrent searches** — Multiple simultaneous tool calls spawn multiple subprocesses. Mitigation: in-session cache reduces this, but no explicit rate limiting

## Skills Discovered

No specialized skills needed beyond TypeScript/Node.js patterns already in codebase.

## Sources

- CCS websearch-transformer.cjs — Proven prompt template and subprocess pattern
- RESEARCH-gemini-cli-search-extension.md — Full architecture and NDJSON format
- jmunch-enforcer/index.ts — pi extension API pattern for tool registration
- GSD-2 google_search extension — Caching strategy, error handling patterns
