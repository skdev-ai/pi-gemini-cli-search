# Project Knowledge

## Code Navigation — jcodemunch (Mandatory)

Use jcodemunch tools for all Python/TypeScript code exploration. Read is blocked on .py/.ts/.tsx files by the jmunch-enforcer extension.

- **Find a function/class:** `jcodemunch_get_symbol(repo, symbol_id)`
- **Search by name:** `jcodemunch_search_symbols(repo, query)` — skip get_file_outline when you already know the name
- **Sliced edit workflow:** get_symbol (find line range) → get_file_content(start_line=line-4, end_line=end_line+3) → Edit. Do NOT read the full file.
- **Full Read only when:** editing 6+ functions in same file, need imports/globals, or file <50 lines
- **Index at session start:** `jcodemunch_index_folder(path=".", incremental=true, use_ai_summaries=false)`
- **Re-index after edits/commits** to keep the index fresh

## Documentation Navigation — jdocmunch (Mandatory)

Use jdocmunch tools for documentation files over 50 lines. Read is blocked on large .md/.mdx/.rst files.

- **Search sections:** `jdocmunch_search_sections(repo, query)`
- **Get specific section:** `jdocmunch_get_section(repo, section_id)`
- **Index at session start:** `jdocmunch_index_local(path=".", use_ai_summaries=false)`
- **Read allowed for:** small docs (<50 lines), CLAUDE.md, SKILL.md, KNOWLEDGE.md, planning files

## Subagent Instructions

When spawning subagents, include jcodemunch/jdocmunch instructions in their prompts. Subagents have access to the same direct tools but need to know the repo ID and workflow patterns.
