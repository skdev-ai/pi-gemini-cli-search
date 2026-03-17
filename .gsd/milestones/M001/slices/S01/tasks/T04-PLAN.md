# T04: Register Tool with pi Extension API

## Description

Wire everything together by registering the `gemini_cli_search` tool with pi's extension API. This is the integration task that makes the functionality available to the agent.

## Steps

1. Create `src/index.ts` with the following implementation:
   - Import pi extension API (follow jmunch-enforcer pattern)
   - Define TypeBox schema for tool parameters: `{ query: string }`
   - Implement `execute()` handler:
     - Check availability (CLI binary + credential file)
     - Call `executeSearch()` from gemini-cli.ts
     - Return structured result with answer and sources
   - Implement `renderAnswer()` function to display result to user
   - Implement `renderError()` function for error states
   - Add `promptGuidelines` to help LLM choose tool correctly
   - Export extension entry point

2. Create `src/index.test.ts` with tests:
   - Tool registers without errors
   - TypeBox schema validates correct input
   - TypeBox schema rejects invalid input
   - Availability check works (mock CLI presence)

3. Verify extension compiles and can be loaded in pi agent

4. Manual integration test:
   - Load extension in pi agent
   - Invoke tool with test query
   - Verify answer displays with resolved sources

## Must-Haves

- Follows jmunch-enforcer pattern for tool registration
- TypeBox schema: `Type.Object({ query: Type.String({ description: 'Search query' }) })`
- Tool name: `gemini_cli_search` (decision D001)
- Tool description clearly states when to use this vs google_search
- `execute()` handler calls availability check, then executeSearch()
- `renderAnswer()` displays answer with numbered source links
- `renderError()` displays structured error messages
- `promptGuidelines` helps LLM choose tool (e.g., "Use for current events, recent information, live data")
- Availability check: `which gemini` + exists `~/.gemini/oauth_creds.json`
- No external dependencies beyond pi extension API and TypeBox

## Verification

- `npx tsc --noEmit` — No TypeScript errors
- `npm test -- index.test.ts` — All tool registration tests pass
- Manual test: Extension loads in pi agent without errors
- Manual test: Tool appears in pi agent tool list
- Manual test: Invoke with query "what is pi agent" → verify answer with sources displays

## Inputs

- `src/types.ts` — All shared types
- `src/url-resolver.ts` — URL resolution (used indirectly via gemini-cli)
- `src/gemini-cli.ts` — executeSearch function
- jmunch-enforcer/index.ts — Reference pattern for tool registration

## Expected Output

- `src/index.ts` — 80-100 lines, extension entry point with tool registration
- `src/index.test.ts` — 40-60 lines, tool registration tests
- Extension compiles and loads in pi agent
- Manual integration test passes

## Observability Impact

- Tool appears in pi agent's tool list with description
- Error messages distinguish failure modes for LLM
- Answer rendering shows resolved source URLs to user
