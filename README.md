# gemini-cli-search

A GSD-2 / Pi Mono extension that provides web search via Gemini CLI, leveraging Google's AI Pro subscription OAuth authentication. Returns AI-synthesized answers with resolved source URLs.

## Why This Approach

Google's Gemini CLI includes `google_web_search` — a grounded search tool that returns AI-synthesized answers with source citations. This extension makes that capability available as a tool inside GSD-2, using your existing Google AI Pro subscription (no separate API key needed).

**Approach to ToS:** The extension spawns official Google binaries (`gemini` CLI and `@google/gemini-cli-a2a-server`) that use the same `@google/gemini-cli-core` library and OAuth credentials as regular Gemini CLI usage. It communicates through Google's own Agent-to-Agent (A2A) and Agent Client Protocol (ACP) implementations built into the Gemini CLI. All API requests use standard CLI traffic patterns — same User-Agent, same auth flow, same endpoints. No reverse-engineering, no direct API calls, no credential extraction.

> **⚠️ DISCLAIMER:** The author is not a lawyer. Google's [ToS](https://geminicli.com/docs/resources/tos-privacy/) states that "directly accessing the services powering Gemini CLI using third-party software" is a violation. This extension uses Google's official A2A and ACP protocols through official Google binaries — whether this constitutes "third-party access" is [under discussion](https://github.com/google-gemini/gemini-cli/discussions/22970). A Google maintainer has [indicated](https://github.com/google-gemini/gemini-cli/discussions/22970#discussioncomment-16198982) that ACP-based integration "sounds like a legitimate use," but this is not a policy commitment. **Use at your own risk.** Starting March 25, 2026, Google is adding abuse detection and traffic prioritization that may affect this extension.

## Transport Modes

The extension uses a three-tier transport cascade for optimal performance:

### A2A (Agent-to-Agent) — Primary, HTTP Server

Runs `@google/gemini-cli-a2a-server` as a persistent HTTP server on `localhost:41242`. Shared across all GSD sessions.

| Metric | Value |
|---|---|
| Boot time | ~12s (once, on first session) |
| Search time | ~7-10s per query |
| Model | gemini-3-flash-preview (hardcoded, fastest + cleanest URLs) |
| Concurrent clients | Yes (isolated tasks per request) |

**How it works:** Sends JSON-RPC 2.0 `message/stream` requests to the A2A server. Receives SSE stream with text-content events. Each search creates an independent task — no context bleed between queries.

**Limitations:** Requires `@google/gemini-cli-a2a-server@0.34.0` installed globally with two patches applied (headless mode fix + per-request model override). Version pinned because future versions may add `clientName` to User-Agent. Server process persists after session exit (shared resource — feature, not bug).

### ACP (Agent Client Protocol) — Fallback, Warm Subprocess

Spawns `gemini --acp` as a persistent subprocess. Communicates via JSON-RPC 2.0 over stdin/stdout.

| Metric | Value |
|---|---|
| Boot time | ~12s (once per process) |
| Search time | ~3-17s per query |
| Model | gemini-3-flash-preview (-m flag at spawn) |
| Session reuse | Single session, reused across all queries |

**How it works:** Initialize → authenticate → session/new handshake once. Then sends `session/prompt` for each query, collects `agent_message_chunk` notifications. Process restarted after 20 ACP-routed queries to reset context window and memory (Gemini CLI has no `session/close`).

**Limitations:** Slower than A2A for search queries. Process tied to the GSD session that spawned it. No concurrent client support.

### Cold Spawn (Ultimate Fallback) — One-Shot Process

Spawns `gemini -o text -p "<prompt>" --yolo -m <model>` per query. The original M001 implementation.

| Metric | Value |
|---|---|
| Boot time | ~12s per query |
| Search time | ~12-15s total |
| Model | gemini-3-flash-preview (-m flag) |

**How it works:** Spawns a fresh process for each search. Collects stdout, extracts links, resolves URLs, returns result. Always works if Gemini CLI is installed and authenticated.

**Limitations:** Pays full boot cost (~12s) on every query. No session reuse.

### Cascade Logic

```
Query arrives
  → Is A2A server running?
    → Yes: Try A2A
      → Success: Return result (transport: 'a2a')
      → Failure: Cache error, check ACP
    → No: Skip to ACP
  → Has ACP fresh error (< 5 min)?
    → No: Try ACP
      → Success: Return result (transport: 'acp')
      → Failure: Cache error, fall to cold
    → Yes: Skip to cold
  → Try cold spawn
    → Success: Return result (transport: 'cold')
    → Failure: Throw error (all transports failed)
```

Error TTL: Failed transports are retried after 5 minutes. Successful queries clear the error cache.

## Commands

### `/gcs-install-a2a`

Interactive wizard to install the A2A server:

1. Checks prerequisites (Gemini CLI installed, OAuth authenticated)
2. Prompts for approval (520-package global npm install)
3. Installs `@google/gemini-cli-a2a-server@0.34.0`
4. Creates restricted workspace (only `google_web_search` tool enabled)
5. Applies two patches (headless mode fix + model override)
6. Verifies patches took effect

### `/gcs-status`

Shows transport health and diagnostics:

```
A2A Server Status:
- Status: running
- Port: 41242
- Uptime: 219s
- Search Count: 3

Transport Layer:
- Active Transport: a2a
- A2A Consecutive Failures: 0
- ACP Consecutive Failures: 0
- Cold Consecutive Failures: 0
```

## Prerequisites

- **Gemini CLI** installed globally: `npm install -g @google/gemini-cli`
- **Google OAuth** authenticated: run `gemini` once to complete browser auth flow
- **OAuth credentials** at `~/.gemini/oauth_creds.json`
- **GSD-2** (v2.30.0+) or Pi Mono

## Installation

1. Copy extension files to the extensions directory:
```bash
# For GSD-2
cp src/*.ts ~/.pi/agent/extensions/gemini-cli-search/

# Install dependencies
cd ~/.pi/agent/extensions/gemini-cli-search
npm install eventsource-parser@3.0.6
```

2. Start GSD and run `/gcs-install-a2a` to set up the A2A server.

3. Search: `Use the gemini_cli_search tool to search for: <your query>`

## Architecture

```
index.ts                    Extension entry point, tool + command registration
├── transport.ts            Cascade wrapper (A2A → ACP → cold)
│   ├── a2a-transport.ts    A2A HTTP transport (fetch + SSE parsing)
│   ├── acp.ts              ACP subprocess transport (JSON-RPC over stdin/stdout)
│   └── cold-spawn.ts       Cold spawn adapter (wraps gemini-cli.ts)
├── a2a-lifecycle.ts        A2A server process management
├── a2a-installer.ts        /gcs-install-a2a wizard
├── a2a-path.ts             A2A binary/package path resolution
├── port-check.ts           Port conflict detection + health checks
├── logger.ts               File-based debug logging (GCS_DEBUG=1)
├── availability.ts         Fast availability checks
├── gemini-cli.ts           Core search execution + link extraction
├── url-resolver.ts         Grounding redirect URL resolution
├── cache.ts                In-session query cache
└── types.ts                Shared types + A2A SSE response types
```

## Answer Pipeline

All three transports produce identical output through a shared pipeline:

1. **Raw text** — collected from Gemini's response (SSE chunks, NDJSON notifications, or stdout)
2. **`extractLinks(text)`** — extracts markdown links, reference-style links, bare URLs
3. **`resolveGroundingUrls(links)`** — resolves `vertexaisearch.cloud.google.com/grounding-api-redirect/` URLs via HEAD requests (302 → actual URL)
4. **`stripLinks(text)`** — removes link syntax from answer, keeps text
5. **NO_SEARCH warning** — added if no links found (Gemini answered from memory)
6. **SearchResult** — `{ answer, sources, transport, warning? }`

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GCS_DEBUG` | unset | Set to `1` to enable debug logging to file |
| `A2A_RESPONSE_TIMEOUT_MS` | `45000` | A2A response timeout (ms) |
| `GEMINI_SEARCH_MODEL` | `gemini-3-flash-preview` | Search model (not recommended to change) |
| `GEMINI_SEARCH_TIMEOUT` | `60000` | Cold spawn timeout (ms) |

### Debug Logging

When `GCS_DEBUG=1`, all debug output is written to `~/.pi/agent/extensions/gemini-cli-search/debug.log`. Each session gets a 4-character ID and logs include PID and working directory for multi-session debugging. No console output — TUI stays clean.

### Search Model

The extension hardcodes `gemini-3-flash-preview` for all transports. This model was selected because:
- **Fastest:** 7.7s average search time (vs 18.9s for pro models)
- **Cleanest URLs:** Returns direct URLs more reliably than pro/thinking models
- **Internal search model is fixed:** `google_web_search` internally always uses `gemini-3-flash-preview` regardless of the main model — the main model only synthesizes the answer

## Security & Workspace Restriction

The A2A server runs with a restricted workspace that blocks all tools except `google_web_search` via an `excludeTools` denylist in the workspace settings. Combined with `GEMINI_YOLO_MODE=true` (auto-approve), only search can execute.

**Important:** `excludeTools` is a denylist, not an allowlist. Version pinning to `v0.34.0` is the primary safety net — if Google adds new tools in a future version, they would not be in the denylist and would be auto-approved. Do not upgrade without checking for new tools.

## Why A2A as Primary Transport

The A2A server provides significant advantages over cold spawn and ACP:

- **Multi-session sharing** — One server instance serves all GSD-2 / Pi Mono sessions simultaneously. No per-session boot cost.
- **Concurrent client support** — Each request gets its own isolated task and context. Multiple sessions can search in parallel with ~1.9x speedup (verified).
- **Warm start** — After initial ~12s boot, all subsequent searches complete in ~7-10s. No repeated Node.js startup overhead.
- **Per-request model selection** — Different clients can use different models simultaneously via the `_model` metadata field (requires patch).
- **Tool restriction** — Restricted workspace ensures only `google_web_search` executes. All other Gemini CLI tools are blocked via `excludeTools` settings.

## Required Patches

The A2A server (`@google/gemini-cli-a2a-server@0.34.0`) requires two patches applied to the bundled `dist/a2a-server.mjs` file. The `/gcs-install-a2a` command applies these automatically.

**Patch 1: Headless mode fix** — The server detects non-TTY environments (spawned by extension) as headless and refuses to use cached OAuth credentials. This patch makes it always report as interactive, allowing it to read existing cached tokens from `~/.gemini/oauth_creds.json`. No interactive prompt is needed — the tokens are already cached.

**Patch 2: Per-request model override** — Allows clients to pass `_model` in message metadata to switch models per-request without restarting the server. The extension uses this to force `gemini-3-flash-preview` for optimal search performance.

Both patches are verified after application. If verification fails, the installer restores from backup automatically. **Patches are lost on `npm update`** — run `/gcs-install-a2a` again after updating the A2A server package.

## Known Limitations

- **Version pinning** — A2A server pinned to v0.34.0. Future published versions may add `clientName` to User-Agent headers (commit `949e85ca5` on GitHub main, not yet published), changing the traffic fingerprint. Do not upgrade without checking.
- **Patches required** — Two patches on the A2A server bundle are lost on `npm update`. Re-run `/gcs-install-a2a` after any update.
- **`excludeTools` is a denylist** — The restricted workspace blocks known tools, but new tools added by Google in future versions would be auto-approved by YOLO mode. Version pinning is the primary safety net.
- **A2A server task accumulation** — Completed tasks are never cleaned up from the server's in-memory store (no delete/TTL in the reference implementation). Negligible for search (~50MB per 500 searches), but the server can be restarted via session restart if needed.
- **ACP session memory** — Gemini CLI has no `session/close`. The ACP process is restarted after 20 ACP-routed queries to reset context window and memory.

## License & Attribution

This extension uses official Google binaries and APIs through their intended interfaces. All authentication flows use Google's standard OAuth mechanism.

The A2A server (`@google/gemini-cli-a2a-server`) is part of the [Gemini CLI](https://github.com/google-gemini/gemini-cli) monorepo, licensed under **Apache 2.0**. The two runtime patches applied by this extension (headless mode fix and per-request model override) are permitted modifications under the Apache 2.0 license (Section 2: Derivative Works). This extension distributes the patch logic (in `a2a-installer.ts`) which modifies the user's local installed copy at install time. No pre-modified Google binaries are distributed.
