# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? |
|---|------|-------|----------|--------|-----------|------------|
| D001 | M001/S01 | tool | Tool name | `gemini_cli_search` | Avoids collision with GSD-2's bundled `google_search` tool; clearest about what it is | No |
| D002 | M001/S01 | prompt | Prompt format | CCS template with "Use the google_web_search tool" instruction | Proven pattern from CCS; without this instruction, Gemini answers from memory instead of searching | No |
| D003 | M001/S01 | parsing | NDJSON source extraction | Parse markdown links from assistant text, not structured metadata | Gemini CLI's stream-json bakes sources into text as markdown links; no separate groundingMetadata like raw API | No |
| D004 | M001/S01 | url-resolution | Grounding redirect URL resolution | HEAD requests to extract Location header; fallback to URL as-is on failure | Opaque `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URLs must be resolved; graceful degradation if HEAD fails | No |
| D005 | M001/S01 | verification | Search verification handling | Return warning alongside answer when no `google_web_search` tool_use event detected | Transparent approach lets LLM decide; doesn't hide failures or retry automatically | Yes — if users report too many false positives |
| D006 | M001/S01 | architecture | Extension type | pi extension tool (not hook, not provider) | Follows existing pi extension pattern; clean integration with agent tool system | No |
| D007 | M001/S01 | execution | Subprocess mode | `spawn` (async) not `spawnSync` (blocking) | 10-second search duration warrants progress feedback and cancellation support | No |
| D008 | M001/S02 | cache | Cache scope | In-session only (not persistent across sessions) | Adds complexity (cache invalidation, storage); in-session is enough for v1; repeated queries in same session are free | Yes — if users request persistent cache |
| D009 | M001/S02 | availability | Availability detection | Check CLI binary presence + `~/.gemini/oauth_creds.json` file existence; detect presence, not token validity | Token may be expired; runtime errors distinguish auth failures from installation issues | No |
| D010 | M001/S02 | scope | Coexistence with google_search | Keep concerns separate; don't auto-fallback or auto-detect which to register | LLM sees both tool descriptions and picks appropriately; avoids confusing LLM with dynamic tool registration | Yes — if user confusion becomes a problem |
| D011 | M001/S02 | config | Environment variables | `GEMINI_SEARCH_MODEL` (default: `gemini-2.5-flash`), `GEMINI_SEARCH_TIMEOUT` (default: 60s) | Follows CCS conventions; provides flexibility for different models and timeout preferences | Yes — based on user feedback |
| D012 | M001/S03 | location | Extension location | Standalone installable extension (like pi-mcp-adapter), not embedded in gsd-2 repo | This project isn't a fork of GSD-2; can be installed to `~/.pi/agent/extensions/` or `.gsd/extensions/` per-project | No |
