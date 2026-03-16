# Gemini CLI Search Extension

## What This Is

A pi (GSD-2) extension that enables web search capabilities by spawning the Gemini CLI binary as a subprocess. Users with Google AI Pro subscriptions authenticated via Gemini CLI can leverage their existing OAuth credentials — no separate API key required.

## Core Value

Enable web search for pi users who have Gemini CLI authenticated but no `GEMINI_API_KEY`, without violating Google's Terms of Service around OAuth token usage.

## Current State

New project. Research completed (`RESEARCH-gemini-cli-search-extension.md`). No implementation yet. Project contains only scaffolding:
- `.gsd/extensions/jmunch-enforcer/` — Extension enforcing jcodemunch/jdocmunch usage
- `.gsd/KNOWLEDGE.md`, `.gsd/preferences.md` — Project preferences

## Architecture / Key Patterns

- **Extension type**: Pi extension tool (not hook, not provider)
- **Subprocess execution**: Spawn `gemini -o stream-json -p "<prompt>" --yolo -m gemini-2.5-flash`
- **Output format**: NDJSON parsing, concatenate assistant messages, extract markdown links
- **URL resolution**: HEAD requests to resolve `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URLs to actual domains
- **Caching**: In-session cache keyed by normalized query
- **Availability detection**: Check gemini CLI binary presence + credential file existence (not token validity)

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [ ] M001: Gemini CLI Search Extension — Working pi extension with core search, operability, and verification
