import { describe, it, beforeEach, vi } from 'vitest';
import { expect } from 'vitest';

// Mock ExtensionAPI for testing
class MockExtensionAPI {
  getActiveTools = vi.fn();
  setActiveTools = vi.fn();
  on = vi.fn((event: string, handler: Function) => {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)?.push(handler);
  });
  eventHandlers: Map<string, Function[]> = new Map();
}

// Import override functions
import { 
  enableOverride, 
  disableOverride, 
  isOverrideEnabled, 
  clearOverride,
  clearPersistedOverride,
  persistOverride,
  shouldAutoEnableOverride,
} from './override.js';

// Mock config module
vi.mock('./config.js', () => ({
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
}));

// Mock logger
vi.mock('./logger.js', () => ({
  debugLog: vi.fn(),
}));

describe('Override Module', () => {
  let mockApi: MockExtensionAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = new MockExtensionAPI() as unknown as MockExtensionAPI;
    clearOverride();
    clearPersistedOverride();
  });

  describe('enableOverride', () => {
    it('stores original tools and filters competing search tools', () => {
      const originalTools = ['gemini_cli_search', 'search-the-web', 'other-tool', 'google_search'];
      mockApi.getActiveTools.mockReturnValue(originalTools);

      enableOverride(mockApi as any);

      expect(mockApi.getActiveTools).toHaveBeenCalled();
      expect(mockApi.setActiveTools).toHaveBeenCalledWith(
        expect.not.arrayContaining(['search-the-web', 'google_search'])
      );
      expect(mockApi.setActiveTools).toHaveBeenCalledWith(
        expect.arrayContaining(['gemini_cli_search', 'other-tool'])
      );
    });

    it('registers before_provider_request hook', () => {
      mockApi.getActiveTools.mockReturnValue(['gemini_cli_search']);

      enableOverride(mockApi as any);

      expect(mockApi.on).toHaveBeenCalledWith('before_provider_request', expect.any(Function));
    });

    it('does nothing if already enabled', () => {
      mockApi.getActiveTools.mockReturnValue(['gemini_cli_search']);

      enableOverride(mockApi as any);
      enableOverride(mockApi as any);

      expect(mockApi.getActiveTools).toHaveBeenCalledTimes(1);
      expect(mockApi.setActiveTools).toHaveBeenCalledTimes(1);
    });

    it('handles getActiveTools failure gracefully', () => {
      mockApi.getActiveTools.mockImplementation(() => {
        throw new Error('API not available');
      });

      expect(() => enableOverride(mockApi as any)).not.toThrow();
      expect(mockApi.setActiveTools).not.toHaveBeenCalled();
    });
  });

  describe('before_provider_request hook', () => {
    it('strips Anthropic native search tool by type', () => {
      mockApi.getActiveTools.mockReturnValue(['gemini_cli_search']);
      enableOverride(mockApi as any);

      // Get the registered handler
      const handlers = mockApi.eventHandlers.get('before_provider_request');
      expect(handlers).toBeDefined();
      const handler = handlers![0];

      // Create a payload with native search tool
      const payload = {
        tools: [
          { type: 'web_search_20250305', name: 'web_search' },
          { type: 'function', name: 'gemini_cli_search' },
        ],
      };

      const result = handler({ payload });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('gemini_cli_search');
    });

    it('strips custom search tools by name', () => {
      mockApi.getActiveTools.mockReturnValue(['gemini_cli_search']);
      enableOverride(mockApi as any);

      const handlers = mockApi.eventHandlers.get('before_provider_request');
      const handler = handlers![0];

      const payload = {
        tools: [
          { type: 'function', name: 'search-the-web' },
          { type: 'function', name: 'search_and_read' },
          { type: 'function', name: 'google_search' },
          { type: 'function', name: 'gemini_cli_search' },
        ],
      };

      const result = handler({ payload });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('gemini_cli_search');
    });

    it('strips both native and custom search tools', () => {
      mockApi.getActiveTools.mockReturnValue(['gemini_cli_search']);
      enableOverride(mockApi as any);

      const handlers = mockApi.eventHandlers.get('before_provider_request');
      const handler = handlers![0];

      const payload = {
        tools: [
          { type: 'web_search_20250305', name: 'web_search' },
          { type: 'function', name: 'search-the-web' },
          { type: 'function', name: 'search_and_read' },
          { type: 'function', name: 'google_search' },
          { type: 'function', name: 'gemini_cli_search' },
          { type: 'function', name: 'other-tool' },
        ],
      };

      const result = handler({ payload });

      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t: any) => t.name)).toEqual(
        expect.arrayContaining(['gemini_cli_search', 'other-tool'])
      );
    });

    it('does not strip tools when override is disabled', () => {
      mockApi.getActiveTools.mockReturnValue(['gemini_cli_search']);
      enableOverride(mockApi as any);
      disableOverride(mockApi as any);

      const handlers = mockApi.eventHandlers.get('before_provider_request');
      const handler = handlers![0];

      const payload = {
        tools: [
          { type: 'web_search_20250305', name: 'web_search' },
          { type: 'function', name: 'search-the-web' },
          { type: 'function', name: 'gemini_cli_search' },
        ],
      };

      const result = handler({ payload });

      // All tools should remain (override disabled)
      expect(result.tools).toHaveLength(3);
    });

    it('handles payload without tools array', () => {
      mockApi.getActiveTools.mockReturnValue(['gemini_cli_search']);
      enableOverride(mockApi as any);

      const handlers = mockApi.eventHandlers.get('before_provider_request');
      const handler = handlers![0];

      const payload = { messages: [] };

      const result = handler({ payload });

      expect(result).toEqual(payload);
    });
  });

  describe('disableOverride', () => {
    it('restores original tools', () => {
      const originalTools = ['gemini_cli_search', 'search-the-web', 'google_search'];
      mockApi.getActiveTools.mockReturnValue(originalTools);

      enableOverride(mockApi as any);
      disableOverride(mockApi as any);

      expect(mockApi.setActiveTools).toHaveBeenCalledWith(
        expect.arrayContaining(['gemini_cli_search', 'search-the-web', 'google_search'])
      );
    });

    it('does nothing if not enabled', () => {
      disableOverride(mockApi as any);

      expect(mockApi.setActiveTools).not.toHaveBeenCalled();
    });
  });

  describe('isOverrideEnabled', () => {
    it('returns false initially', () => {
      expect(isOverrideEnabled()).toBe(false);
    });

    it('returns true after enabling', () => {
      mockApi.getActiveTools.mockReturnValue(['gemini_cli_search']);
      enableOverride(mockApi as any);

      expect(isOverrideEnabled()).toBe(true);
    });

    it('returns false after disabling', () => {
      mockApi.getActiveTools.mockReturnValue(['gemini_cli_search']);
      enableOverride(mockApi as any);
      disableOverride(mockApi as any);

      expect(isOverrideEnabled()).toBe(false);
    });
  });

  describe('clearOverride', () => {
    it('resets override state', () => {
      mockApi.getActiveTools.mockReturnValue(['gemini_cli_search']);
      enableOverride(mockApi as any);
      clearOverride();

      expect(isOverrideEnabled()).toBe(false);
    });
  });

  describe('persistOverride', () => {
    it('saves override to config', async () => {
      const { loadConfig, saveConfig } = await import('./config.js');

      persistOverride();

      expect(loadConfig).toHaveBeenCalled();
      expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ override: true }));
    });
  });

  describe('clearPersistedOverride', () => {
    it('removes override from config', async () => {
      const { loadConfig, saveConfig } = await import('./config.js');

      clearPersistedOverride();

      expect(loadConfig).toHaveBeenCalled();
      expect(saveConfig).toHaveBeenCalledWith(expect.not.objectContaining({ override: true }));
    });
  });

  describe('shouldAutoEnableOverride', () => {
    it('returns false when no config', async () => {
      const { loadConfig } = await import('./config.js');
      vi.mocked(loadConfig).mockReturnValue({});

      expect(shouldAutoEnableOverride()).toBe(false);
    });

    it('returns true when override is set in config', async () => {
      const { loadConfig } = await import('./config.js');
      vi.mocked(loadConfig).mockReturnValue({ override: true });

      expect(shouldAutoEnableOverride()).toBe(true);
    });
  });
});
