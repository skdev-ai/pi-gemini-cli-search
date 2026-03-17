# gemini-cli-search

A pi (GSD) extension that provides web search capabilities via the Gemini CLI subprocess. Returns AI-synthesized answers with resolved source URLs.

## Features

- **Web Search**: Search the web for current information, recent events, or live data
- **AI Synthesis**: Returns synthesized answers from Gemini's reasoning over search results
- **Resolved URLs**: Automatically resolves shortened/redirect URLs to their final destinations
- **In-Session Caching**: Repeated queries return instantly from cache (cleared on session start)
- **Availability Detection**: Checks for CLI installation and authentication before search
- **Progress Streaming**: Real-time progress updates during search execution
- **Cancellation Support**: Abort mid-search to terminate subprocess and free resources

## Installation

```bash
# Install the Gemini CLI (required)
npm install -g @anthropics/gemini-cli

# Authenticate with Gemini
gemini auth login

# Install the extension (add to your pi configuration)
```

## Usage

The extension registers a `gemini_cli_search` tool that can be called with:

```json
{
  "query": "latest AI news 2026"
}
```

Returns an AI-synthesized answer with numbered source links.

## Configuration

The following environment variables can be set to customize behavior:

- `GEMINI_SEARCH_MODEL` — Gemini model to use (default: `gemini-2.5-flash`)
- `GEMINI_SEARCH_TIMEOUT` — Timeout in milliseconds (default: `60000`)

Example:
```bash
export GEMINI_SEARCH_MODEL=gemini-2.5-pro
export GEMINI_SEARCH_TIMEOUT=120000
```

## Error Handling

The extension provides structured error messages for common failure modes:

| Error Code | Message | Resolution |
|------------|---------|------------|
| `CLI_NOT_FOUND` | Gemini CLI is not installed or not in PATH | Install with `npm install -g @anthropics/gemini-cli` |
| `NOT_AUTHENTICATED` | Gemini CLI authentication failed | Run `gemini auth login` |
| `TIMEOUT` | Search timed out | Increase `GEMINI_SEARCH_TIMEOUT` or simplify query |
| `PARSE_ERROR` | Failed to parse Gemini CLI output | Report as a bug |
| `SEARCH_FAILED` | Search operation failed | Check Gemini CLI status |

## Caching Behavior

- Query results are cached for the duration of a session
- Cache is keyed by normalized query (lowercase, trimmed)
- Cache is automatically cleared on `session_start` event
- Both successful results and errors are cached to prevent redundant failed calls
- Cache hits skip all processing (no subprocess, no progress events)

## Diagnostics

Console logs provide visibility into extension behavior:

```
[gemini-cli-search] Cache hit for query: <query>
[gemini-cli-search] Tool available and ready
[gemini-cli-search] Tool unavailable: CLI_NOT_FOUND
```

## License

MIT
