# Gemini CLI Search Extension

## What This Is

A pi (GSD-2) extension that enables web search capabilities by spawning the Gemini CLI binary as a subprocess. Users with Google AI Pro subscriptions authenticated via Gemini CLI can leverage their existing OAuth credentials — no separate API key required.

## Core Value

Enable web search for pi users who have Gemini CLI authenticated but no `GEMINI_API_KEY`, without violating Google's Terms of Service around OAuth token usage.

## Current State

**S01 complete (2026-03-16).** Core search functionality implemented and tested:
- 41 passing unit tests across 4 test files
- TypeScript compilation successful with strict mode
- Tool registered with pi extension API
- NDJSON parsing extracts assistant messages and markdown links
- URL resolution via HEAD requests with graceful fallback
- Search verification detects memory answers (NO_SEARCH warning)

**Ready for S02:** Operability & resilience (caching, availability detection, progress streaming, cancellation, environment configuration).

## Architecture / Key Patterns

- **Extension type**: Pi extension tool (not hook, not provider)
- **Subprocess execution**: Spawn `gemini -o stream-json -p "<prompt>" --yolo -m gemini-2.5-flash`
- **Output format**: NDJSON parsing, concatenate assistant messages, extract markdown links
- **URL resolution**: HEAD requests to resolve `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URLs to actual domains (fallback on failure)
- **Search verification**: Detect `google_web_search` tool_use events; return warning if absent
- **Error handling**: Structured error types (CLI_NOT_FOUND, NOT_AUTHENTICATED, TIMEOUT, PARSE_ERROR, SEARCH_FAILED)
- **Type safety**: TypeScript strict mode with NodeNext module resolution; TypeBox runtime validation

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [ ] M001: Gemini CLI Search Extension — Working pi extension with core search, operability, and verification
