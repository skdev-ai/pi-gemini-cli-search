---
version: 1
custom_instructions:
  - "Always use jcodemunch direct tools for Python/TypeScript code navigation instead of Read. Use jcodemunch_get_symbol, jcodemunch_search_symbols, jcodemunch_get_file_content for sliced reads."
  - "Always use jdocmunch direct tools for documentation files over 50 lines. Use jdocmunch_search_sections and jdocmunch_get_section."
  - "Run jcodemunch_index_folder and jdocmunch_index_local at the start of each session before doing any code/doc exploration."
  - "When spawning subagents, include jcodemunch/jdocmunch usage instructions in their prompts."
---
