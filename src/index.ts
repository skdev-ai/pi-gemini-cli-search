import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { executeSearch } from "./gemini-cli.js";
import type { SearchResult } from "./types.js";
import { get, set, clear as clearCache } from "./cache.js";
import { checkAvailability } from "./availability.js";

/**
 * Gemini CLI Search Extension
 * 
 * Provides a tool for executing web searches via the Gemini CLI subprocess,
 * returning AI-synthesized answers with resolved source URLs.
 */

// ── Tool Schema ──────────────────────────────────────────────────────────────

const SearchParamsSchema = Type.Object({
  query: Type.String({ 
    description: 'Search query for current information, recent events, or live data' 
  }),
});

// ── Result Rendering ────────────────────────────────────────────────────────

/**
 * Renders a successful search result with answer and numbered source links.
 * Displays resolved URLs (not opaque vertexaisearch redirects).
 */
function renderAnswer(result: SearchResult): string {
  const lines: string[] = [];
  
  // Add the answer
  if (result.answer) {
    lines.push(result.answer);
  }
  
  // Add warning if present (Gemini answered from memory)
  if (result.warning) {
    lines.push('');
    lines.push(`⚠️ **${result.warning.message}**`);
  }
  
  // Add sources with resolved URLs
  if (result.sources.length > 0) {
    lines.push('');
    lines.push('**Sources:**');
    result.sources.forEach((source, index) => {
      if (source.resolvedSuccessfully) {
        lines.push(`${index + 1}. ${source.resolved}`);
      } else {
        // Show title from extraction instead of opaque grounding redirect
        const title = source.title || 'Unknown source';
        lines.push(`${index + 1}. ${title} (URL could not be resolved)`);
      }
    });
  }
  
  return lines.join('\n');
}

/**
 * Renders an error result with structured, machine-distinguishable error messages.
 * Helps the LLM understand what went wrong and how to fix it.
 */
function renderError(result: SearchResult): string {
  if (!result.error) {
    return 'Unknown error occurred';
  }
  
  const errorMessages: Record<string, string> = {
    CLI_NOT_FOUND: 'Gemini CLI is not installed or not in PATH',
    NOT_AUTHENTICATED: 'Gemini CLI authentication failed',
    TIMEOUT: 'Search timed out',
    PARSE_ERROR: 'Failed to parse Gemini CLI output',
    SEARCH_FAILED: 'Search operation failed',
  };
  
  const baseMessage = errorMessages[result.error.type] || result.error.message;
  
  return `**Search Error (${result.error.type}):** ${baseMessage}`;
}

// ── Extension Entry Point ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Register the gemini_cli_search tool
  pi.registerTool({
    name: 'gemini_cli_search',
    label: 'Gemini CLI Search',
    description: 'Search the web for current information, recent events, or live data using Gemini CLI. Use this instead of google_search when you need to leverage Gemini\'s reasoning capabilities with grounded search results. Returns AI-synthesized answers with resolved source URLs.',
    parameters: SearchParamsSchema,
    promptGuidelines: [
      'Use this tool when you need current or recent information that may not be in your training data',
      'Use for live data: latest software versions, recent news, current events, newly released documentation',
      'Use when you need AI reasoning over search results, not just a list of links',
      'Do NOT use for historical facts, well-established knowledge, or information unlikely to have changed',
    ].join('\n'),
    
    execute: async (
      _toolCallId: string,
      params: { query: string },
      signal: AbortSignal | undefined,
      onUpdate: ((message: string) => void) | undefined,
      _ctx: unknown
    ) => {
      // Check cache first
      const cached = get(params.query);
      if (cached) {
        console.log('[gemini-cli-search] Cache hit for query:', params.query);
        if (cached.error) {
          return {
            content: [{ type: 'text', text: renderError(cached) }],
          };
        }
        return {
          content: [{ type: 'text', text: renderAnswer(cached) }],
        };
      }
      
      // Check availability before executing
      const availability = checkAvailability();
      if (!availability.available) {
        const errorResult: SearchResult = {
          answer: '',
          sources: [],
          error: {
            type: 'CLI_NOT_FOUND',
            message: availability.reason || 'Gemini CLI not available',
          },
        };
        // Cache the error result
        set(params.query, errorResult);
        return {
          content: [{ 
            type: 'text', 
            text: renderError(errorResult),
          }],
        };
      }
      
      // Execute the search
      const result = await executeSearch(params.query, {
        signal,
        onUpdate,
      });
      
      // Cache the result (including errors/warnings)
      set(params.query, result);
      
      // Render and return the result
      if (result.error) {
        return {
          content: [{ type: 'text', text: renderError(result) }],
        };
      }
      
      return {
        content: [{ type: 'text', text: renderAnswer(result) }],
      };
    },
  });
  
  // Notify on session start
  pi.on('session_start', async () => {
    // Clear cache on session start to prevent stale data
    clearCache();
    
    const availability = checkAvailability();
    if (availability.available) {
      console.log('[gemini-cli-search] Tool available and ready');
    } else {
      console.log(`[gemini-cli-search] Tool unavailable: ${availability.reason}`);
    }
  });
}
