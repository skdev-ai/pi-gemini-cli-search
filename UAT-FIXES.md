# UAT Fixes — Issues discovered during manual testing

## Fix 1: Standardize log prefixes
**Severity:** Cosmetic
**Files:** transport.ts, a2a-transport.ts, a2a-lifecycle.ts, acp.ts, a2a-installer.ts, index.ts
**Issue:** Each module uses a different console.log prefix: `[transport]`, `[a2a-transport]`, `[acp]`, `[A2A Lifecycle]`, `[A2A Install]`, `[gemini-cli-search]`. Should all use `[gemini-cli-search]` for consistency when loaded alongside other GSD extensions.
**Fix:** Change all `log()` functions to use `[gemini-cli-search]` prefix. Optionally use sub-module format: `[gemini-cli-search:transport]`, `[gemini-cli-search:acp]`, etc.

## Fix 2: Rename command namespace from /gemini to /gcs
**Severity:** UX
**Files:** index.ts
**Issue:** `/gemini install-a2a` and `/gemini status` are too generic — "gemini" could refer to anything. Should use `/gcs` (gemini-cli-search) to be specific to this extension and avoid future conflicts with other Gemini-related extensions.
**Fix:** Rename commands to `/gcs install-a2a`, `/gcs status`. Update any references in research docs, KNOWLEDGE.md, and task summaries.

## Fix 3: Command registration has leading slash causing //double-slash
**Severity:** Bug — commands don't work properly
**Files:** index.ts
**Issue:** Commands registered as `pi.registerCommand('/gemini install-a2a', ...)` with a leading `/`. The Pi framework adds its own `/` prefix, resulting in `//gemini install-a2a`. Tab autocomplete also mangles the input (`//gemini install-a2aemini install-a2a`).
**Fix:** Register WITHOUT the leading slash: `pi.registerCommand('gemini install-a2a', ...)` or `pi.registerCommand('gcs install-a2a', ...)`. Check how the jmunch-enforcer registered commands (e.g., `/jmunch status`) for the correct pattern — it may have used the slash or not.

## Fix 4: CRITICAL — Command registration uses wrong API signature
**Severity:** Bug — commands never register, LLM treats them as user messages
**Files:** index.ts
**Issue:** Commands registered as `pi.registerCommand('name', async (ctx) => {...})` — bare callback. But Pi/GSD framework expects `pi.registerCommand('name', { description: '...', handler: async (args, ctx) => {...} })` — object with description + handler. See how GSD built-in extensions do it: `pi.registerCommand("gsd", { description: "...", handler: async (args, ctx) => {...} })`. Also command names should use hyphens not spaces (`gcs-install-a2a` not `gcs install-a2a`).
**Fix:** Change both command registrations to match the GSD pattern:
```typescript
pi.registerCommand('gcs-install-a2a', {
  description: 'Install and patch A2A server for search transport',
  handler: async (args, ctx) => { ... }
});
pi.registerCommand('gcs-status', {
  description: 'Show gemini-cli-search transport status and diagnostics',
  handler: async (args, ctx) => { ... }
});
```

## Fix 5: [object Object] displayed in install approval TUI
**Severity:** Cosmetic
**Files:** a2a-installer.ts (requestApproval function), index.ts (command handler ctx adapter)
**Issue:** The confirmation dialog shows `[object Object]` after the message text. The `ctx.ui.confirm()` second argument (options object with title/detail) is being rendered as a string in GSD's TUI instead of being used as metadata.
**Fix:** Check if GSD's `ctx.ui.confirm()` supports the `{ title, detail }` second argument. If not, fold the title into the message string and remove the options object. Also check the adapter in index.ts that bridges ctx to InstallerContext — it may be passing the options incorrectly.

## Fix 6: After /gcs-install-a2a succeeds, auto-start A2A server immediately
**Severity:** UX gap
**Files:** index.ts (gcs-install-a2a handler)
**Issue:** After installing A2A mid-session, the A2A server stays idle until next session. The cascade falls back to ACP/cold even though A2A is now ready. User has to restart GSD to get A2A transport.
**Fix:** After `installA2AServer()` succeeds in the command handler, call `startServer()` (from a2a-lifecycle.ts) to auto-start the A2A server immediately. Then the next search uses A2A without needing a session restart.

## Fix 7: /gcs-status missing ACP state information
**Severity:** UX gap
**Files:** index.ts (gcs-status handler)
**Issue:** Status command shows A2A server state but no ACP information. After an ACP search, user can't see ACP query count (1/20), ACP process state, or ACP uptime. `getAcpState()` is exported from acp.ts but not called in the status handler.
**Fix:** Import `getAcpState` from acp.ts and add ACP section to status output showing: status (idle/running/error), query count (N/20), last error if any, uptime.

## Fix 8a: Startup messages should use GSD notification format, not console.log
**Severity:** UX
**Files:** index.ts (session_start handler), a2a-lifecycle.ts (startServer)
**Issue:** Startup messages like `[transport] Resetting transport state`, `[gemini-cli-search] Tool available and ready`, `[A2A Lifecycle] Starting A2A server...` show as raw console.log lines. They should either be hidden or displayed in GSD's notification format like `Web search v4 loaded · Jina ✓` or as warnings like `Warning: Google Search: No authentication set...`.
**Fix:** Replace startup console.log with `ctx.ui.notify()` for important status (e.g., `gemini-cli-search loaded · A2A ✓ · ACP ✓`) and suppress internal messages. Errors/warnings should use GSD's warning format. Internal state messages should be debug-only (see Fix 8).

## Fix 8: Console.log spam visible in TUI — need debug flag
**Severity:** UX — noisy in production
**Files:** ALL modules (transport.ts, a2a-transport.ts, a2a-lifecycle.ts, acp.ts, a2a-installer.ts, index.ts)
**Issue:** All `console.log('[transport] ...', '[acp] ...', etc.)` messages are visible in the GSD TUI during searches. Fine for debugging but noisy for daily use.
**Fix:** Add a debug flag (env var `GCS_DEBUG=1` or similar). All log() functions check the flag before logging. Default off. When off, logs are silent. When on, logs go to console (or optionally to a file). The `/gcs-status` command could show debug state and offer a toggle.

## Fix 11: Ctrl+C doesn't cancel in-flight search
**Severity:** UX — can't cancel slow searches
**Files:** Not our bug — GSD/Pi framework responsibility
**Issue:** Pressing Ctrl+C during an active gemini_cli_search tool call doesn't cancel the search. The AbortSignal from Pi's tool framework needs to be triggered by GSD's cancel mechanism (Escape key?), not raw Ctrl+C which GSD intercepts for session shutdown. Our abort handling works (tested), but GSD never fires the signal during tool execution.
**Fix:** Not actionable from our extension. File as GSD-2 issue or check if Escape triggers tool cancellation in GSD's TUI.

## Fix 12: IMPORTANT — User abort cascades to fallback transports instead of cancelling
**Severity:** UX bug — cancel doesn't actually cancel
**Files:** transport.ts (executeSearch cascade logic)
**Issue:** When user presses Escape during an A2A search, the abort signal correctly cancels A2A. But the cascade treats the TIMEOUT error as a transport failure and falls through to ACP, which runs the same query. The user pressed cancel but still gets a result after a delay.
**Root cause:** In transport.ts, the catch block after A2A failure doesn't check if the abort was user-initiated vs transport-timeout. Both throw TIMEOUT errors but should be handled differently: user abort → stop entire cascade; transport timeout → fallback to next tier.
**Fix:** In transport.ts catch block (after A2A attempt), check `signal?.aborted` before falling through. If the caller's signal is aborted, throw immediately instead of continuing to ACP/cold:
```typescript
} catch (error) {
  // Check if this was a USER abort, not a transport failure
  if (signal?.aborted) {
    throw createSearchError('TIMEOUT', 'Search cancelled by user');
  }
  // Otherwise, cache error and fall through to next transport
  ...
}
```

## Fix 13: A2A server should be shared across GSD sessions, not per-session subprocess
**Severity:** Architecture — blocks multi-session A2A usage (key A2A benefit)
**Files:** a2a-lifecycle.ts, index.ts
**Issue:** Currently each GSD session tries to spawn its own A2A server as a child process. Second session fails on port 41242 conflict. When the owning session exits, server dies for all. This defeats the main A2A advantage: multi-session sharing with concurrent client support (verified 1.9x parallel speedup).
**Fix (phased):**
- **Phase 1 (M002 fix):** Before spawning, check if port 41242 is already in use (TCP connect test or HTTP GET to /.well-known/agent-card.json). If server already running, skip spawn and reuse. If not running, spawn as detached process (`detached: true`, `unref()`) so it survives session exit.
- **Phase 2 (M003):** Add `/gcs-server start|stop|restart` command for manual server lifecycle. Consider standalone startup script or systemd unit file. Server runs independently of any GSD session.
- **Key behaviors:** (1) First session to need A2A starts the server if not running, (2) All sessions detect and reuse running server, (3) Server survives session exit (detached), (4) `/gcs-status` shows server PID and whether it's owned by this session or external.

## Fix 9: CRITICAL — A2A server exits immediately (code 0) on Node 22
**Severity:** Bug — A2A transport completely broken
**Files:** a2a-lifecycle.ts (startServer function, line ~328)
**Issue:** The A2A server's `isMainModule` check compares `path.basename(process.argv[1])` with `path.basename(import.meta.url)`. When spawned via `gemini-cli-a2a-server` binary (symlink), the basenames don't match: `gemini-cli-a2a-server` vs `a2a-server.mjs`. So `main()` never runs and the process exits with code 0.
**Fix:** Change `spawn('gemini-cli-a2a-server', [])` to `spawn('node', [bundlePath])` where `bundlePath` is `getA2APackageRoot() + '/dist/a2a-server.mjs'`. This way `process.argv[1]` is `a2a-server.mjs` which matches the `isMainModule` check. Note: this was the original approach before a review suggested changing to the binary name — the review was wrong for this specific case.

## Fix 10: A2A server starts then immediately exits with code 0
**Severity:** CRITICAL — A2A transport broken
**Files:** a2a-lifecycle.ts
**Issue:** The A2A server successfully starts (`Agent Server started on http://localhost:41242`) and is detected as running, but then immediately exits with code 0 (clean shutdown). The server runs standalone for 4+ seconds in manual tests, so something in the GSD/extension context is causing it to exit. Possible causes: (1) child process inheriting parent stdio and GSD TUI closing/resetting streams, (2) the `detached` option not set so the child dies with parent context changes, (3) the `readline` interface on child stdout is keeping the process referenced but something unrefs it.
**Root cause found:** An old A2A server from Node 20 (PID 2944628, started Mar 18) was still running on port 41242. The new server started, couldn't bind the port, and exited with code 0. NOT a code bug — a stale process issue.
**Fix:** The lifecycle module should detect "port already in use" at startup: (1) Before spawning, check if port 41242 is already in use via a quick TCP connect test. (2) If in use, check if it's OUR server (via /.well-known/agent-card.json health check) — if so, reuse it. (3) If it's a stale/foreign process, log a warning and either kill it or report to user. Also: exit code 0 should not be logged as "crashed unexpectedly" — it's a clean exit. Add specific handling for code 0 vs non-zero.
