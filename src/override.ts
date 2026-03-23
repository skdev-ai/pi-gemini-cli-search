import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { loadConfig, saveConfig } from "./config.js";
import { debugLog } from "./logger.js";

/**
 * Minimal interface for tool management APIs (not in ExtensionAPI types but available at runtime)
 */
interface ToolManagementAPI extends ExtensionAPI {
  getActiveTools(): string[];
  setActiveTools(tools: string[]): void;
}

/**
 * Competing search tool NAMES to disable when override is active
 * These are stripped from the tools array in before_provider_request
 */
const COMPETING_TOOL_NAMES = [
  'search-the-web',
  'search_and_read', 
  'google_search'
];

/**
 * Anthropic's native web search tool type (injected server-side)
 * This is stripped from the tools array in before_provider_request
 */
const NATIVE_SEARCH_TYPE = 'web_search_20250305';

/**
 * In-memory override state
 */
let overrideEnabled = false;
let originalTools: string[] | null = null;
let beforeProviderRequestHandler: ((event: any) => any) | null = null;

/**
 * Enable override mode:
 * - Store current tool list
 * - Filter out competing search tools via setActiveTools()
 * - Register before_provider_request hook to strip Anthropic native search
 */
export function enableOverride(pi: ExtensionAPI): void {
  const piWithTools = pi as ToolManagementAPI;
  
  if (overrideEnabled) {
    debugLog('override', 'Override already enabled');
    return;
  }
  
  // Store original tool list
  try {
    originalTools = piWithTools.getActiveTools();
    debugLog('override', `Stored ${originalTools.length} original tools`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog('override', `Failed to get active tools: ${message}`);
    return;
  }
  
  // Filter out competing search tools (best-effort, may not work if tools not yet registered)
  const filteredTools = originalTools.filter(
    tool => !COMPETING_TOOL_NAMES.includes(tool)
  );
  
  try {
    piWithTools.setActiveTools(filteredTools);
    overrideEnabled = true;
    debugLog('override', `Override enabled: ${originalTools.length} → ${filteredTools.length} tools`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog('override', `Failed to set active tools: ${message}`);
    return;
  }
  
  // Register before_provider_request hook to strip BOTH Anthropic native search AND custom search tools
  // This fires on EVERY provider request, ensuring override works even if tools register async
  beforeProviderRequestHandler = (event: any) => {
    if (!overrideEnabled) {
      return event.payload;
    }
    
    const payload = event.payload as Record<string, unknown>;
    if (Array.isArray(payload.tools)) {
      const toolsBefore = (payload.tools as any[]).length;
      
      // Strip Anthropic native search tool by type
      payload.tools = (payload.tools as any[]).filter(
        (t: any) => {
          // Strip native search by type
          if (t.type === NATIVE_SEARCH_TYPE) {
            return false;
          }
          // Strip custom search tools by name (supports both Anthropic and OpenAI formats)
          const toolName = t.name || t.function?.name;
          if (toolName && COMPETING_TOOL_NAMES.includes(toolName)) {
            return false;
          }
          return true;
        }
      );
      
      const toolsAfter = (payload.tools as any[]).length;
      
      if (toolsBefore !== toolsAfter) {
        debugLog('override', `Stripped ${toolsBefore - toolsAfter} search tool(s) from provider request (native + custom)`);
      }
    }
    
    return payload;
  };
  
  try {
    pi.on('before_provider_request', beforeProviderRequestHandler);
    debugLog('override', 'Registered before_provider_request hook');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog('override', `Failed to register before_provider_request hook: ${message}`);
  }
}

/**
 * Disable override mode:
 * - Restore original tool list
 * - Unregister before_provider_request hook
 */
export function disableOverride(pi: ExtensionAPI): void {
  const piWithTools = pi as ToolManagementAPI;
  
  if (!overrideEnabled) {
    debugLog('override', 'Override not enabled');
    return;
  }
  
  // Unregister before_provider_request hook
  // Note: Pi API doesn't support removing event listeners, but the handler
  // checks overrideEnabled at the start and returns early when false.
  // Setting this to null is just cleanup - the flag is what actually disables it.
  if (beforeProviderRequestHandler) {
    try {
      beforeProviderRequestHandler = null;
      debugLog('override', 'before_provider_request hook disabled (flag-based, not unregistered)');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      debugLog('override', `Failed to clear hook reference: ${message}`);
    }
  }
  
  // Restore original tools
  if (originalTools) {
    try {
      piWithTools.setActiveTools(originalTools);
      debugLog('override', `Restored ${originalTools.length} original tools`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      debugLog('override', `Failed to restore tools: ${message}`);
    }
  }
  
  overrideEnabled = false;
  originalTools = null;
}

/**
 * Check if override is currently enabled
 */
export function isOverrideEnabled(): boolean {
  return overrideEnabled;
}

/**
 * Get the stored original tool list (for session persistence)
 */
export function getOriginalTools(): string[] | null {
  return originalTools;
}

/**
 * Clear override state (called on session_end)
 */
export function clearOverride(): void {
  overrideEnabled = false;
  originalTools = null;
  beforeProviderRequestHandler = null;
  debugLog('override', 'Override state cleared');
}

/**
 * Persist override setting to config file
 */
export function persistOverride(): void {
  try {
    const config = loadConfig();
    config.override = true;
    saveConfig(config);
    debugLog('override', 'Override persisted to config');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog('override', `Failed to persist override: ${message}`);
  }
}

/**
 * Clear persisted override setting from config file
 */
export function clearPersistedOverride(): void {
  try {
    const config = loadConfig();
    delete config.override;
    saveConfig(config);
    debugLog('override', 'Override cleared from config');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog('override', `Failed to clear persisted override: ${message}`);
  }
}

/**
 * Check if override should be auto-enabled from config
 */
export function shouldAutoEnableOverride(): boolean {
  try {
    const config = loadConfig();
    return config.override === true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog('override', `Failed to check auto-enable: ${message}`);
    return false;
  }
}
