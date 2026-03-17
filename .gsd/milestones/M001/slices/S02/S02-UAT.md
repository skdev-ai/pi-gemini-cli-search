# S02: Operability & Resilience — UAT Test Plan

This document contains manual test cases for verifying the S02 slice features: in-session caching, availability detection, progress streaming, and cancellation support.

## Prerequisites

- Gemini CLI installed (`gemini --version` works)
- Gemini CLI authenticated (`~/.gemini/oauth_creds.json` exists)
- Extension loaded in pi environment

---

## Test 1: First Query Returns Answer with Progress Messages

**Objective:** Verify that the first query executes a full search and shows progress messages.

**Steps:**
1. Start a fresh pi session (ensures cache is empty)
2. Execute: `gemini_cli_search({ query: "latest news about AI 2026" })`
3. Observe console output and UI

**Expected Results:**
- ✅ Search takes ~5-15 seconds (not instant)
- ✅ Progress messages appear: "Starting search…" → "Parsing response…" → "Resolving X source URLs…" → "Complete"
- ✅ Answer is returned with source links
- ✅ Console shows: `[gemini-cli-search] Tool available and ready`

**Pass Criteria:** All expected results observed.

---

## Test 2: Repeated Query Returns Cached Result (Instant)

**Objective:** Verify that repeated queries return instantly from cache without progress messages.

**Steps:**
1. Continue from Test 1 (same session)
2. Execute the same query again: `gemini_cli_search({ query: "latest news about AI 2026" })`
3. Observe timing and console output

**Expected Results:**
- ✅ Result returns instantly (<100ms)
- ✅ No progress messages appear (no "Starting search…", etc.)
- ✅ Console shows: `[gemini-cli-search] Cache hit for query: latest news about AI 2026`
- ✅ Same answer and sources as Test 1

**Pass Criteria:** All expected results observed.

---

## Test 3: Cancel Mid-Search Terminates Subprocess

**Objective:** Verify that cancelling a search terminates the subprocess cleanly.

**Steps:**
1. Start a new pi session
2. Execute a query with a long-running search (e.g., complex multi-part query)
3. Cancel the search mid-execution (Ctrl+C or pi cancel action)
4. Observe process termination

**Expected Results:**
- ✅ Subprocess is terminated (no hanging `gemini` processes)
- ✅ Error message indicates cancellation: "Search was cancelled"
- ✅ No resource leaks (verify with `ps aux | grep gemini`)

**Pass Criteria:** Subprocess terminates cleanly, no hanging processes.

---

## Test 4: Run Without Gemini CLI Shows Clear Error

**Objective:** Verify that missing CLI binary produces a clear, actionable error.

**Steps:**
1. Temporarily move or rename the `gemini` binary (e.g., `mv $(which gemini) /tmp/gemini.bak`)
2. Execute: `gemini_cli_search({ query: "test" })`
3. Observe error message

**Expected Results:**
- ✅ Error type: `CLI_NOT_FOUND`
- ✅ Error message: "Gemini CLI is not installed or not in PATH"
- ✅ Helpful resolution hint in message
- ✅ No subprocess attempt (fails fast)

**Pass Criteria:** Clear, actionable error message displayed.

**Cleanup:** Restore the binary: `mv /tmp/gemini.bak $(which gemini)`

---

## Test 5: Run Without Auth Shows Clear Error

**Objective:** Verify that missing authentication produces a clear, actionable error.

**Steps:**
1. Temporarily move the OAuth credentials file: `mv ~/.gemini/oauth_creds.json ~/.gemini/oauth_creds.json.bak`
2. Execute: `gemini_cli_search({ query: "test" })`
3. Observe error message

**Expected Results:**
- ✅ Error type: `NOT_AUTHENTICATED`
- ✅ Error message: "Gemini CLI authentication failed"
- ✅ Helpful resolution hint in message
- ✅ No subprocess attempt (fails fast)

**Pass Criteria:** Clear, actionable error message displayed.

**Cleanup:** Restore the credentials: `mv ~/.gemini/oauth_creds.json.bak ~/.gemini/oauth_creds.json`

---

## Test 6: Custom Model via Environment Variable Works

**Objective:** Verify that `GEMINI_SEARCH_MODEL` environment variable overrides the default model.

**Steps:**
1. Set custom model: `export GEMINI_SEARCH_MODEL=gemini-2.5-pro`
2. Execute: `gemini_cli_search({ query: "test query" })`
3. Observe the spawned subprocess (or add logging to verify model parameter)

**Expected Results:**
- ✅ Subprocess uses the specified model (`gemini-2.5-pro`)
- ✅ Search completes successfully
- ✅ Answer returned with sources

**Pass Criteria:** Custom model is used in the search.

**Cleanup:** Unset the variable: `unset GEMINI_SEARCH_MODEL`

---

## Test 7: Custom Timeout via Environment Variable Works

**Objective:** Verify that `GEMINI_SEARCH_TIMEOUT` environment variable controls timeout behavior.

**Steps:**
1. Set very short timeout: `export GEMINI_SEARCH_TIMEOUT=1000` (1 second)
2. Execute a query that will take longer: `gemini_cli_search({ query: "comprehensive analysis of AI trends" })`
3. Observe timeout behavior

**Expected Results:**
- ✅ Search times out after ~1 second
- ✅ Error type: `TIMEOUT`
- ✅ Error message: "Search timed out after 1000ms"
- ✅ Subprocess is terminated cleanly

**Pass Criteria:** Timeout occurs at the specified duration.

**Cleanup:** Unset the variable: `unset GEMINI_SEARCH_TIMEOUT`

---

## Summary Checklist

| Test | Feature | Status | Notes |
|------|---------|--------|-------|
| 1 | First query with progress | ⬜ | |
| 2 | Cached query (instant) | ⬜ | |
| 3 | Cancel mid-search | ⬜ | |
| 4 | Missing CLI error | ⬜ | |
| 5 | Missing auth error | ⬜ | |
| 6 | Custom model env var | ⬜ | |
| 7 | Custom timeout env var | ⬜ | |

**Tester:** ________________  
**Date:** ________________  
**Environment:** pi version __________, gemini-cli version __________
