/**
 * A2A Transport Unit Tests
 * 
 * Comprehensive tests for executeSearchA2A() covering:
 * - Successful search with complete SSE stream parsing
 * - Connection refused errors
 * - Authentication expired errors
 * - Timeout errors (connection and response)
 * - AbortSignal cancellation
 * - Search count increment
 * - Progress callback invocations
 * - Transport field verification
 * - SSE parsing with multiple message parts
 * - Task completion detection
 * - Link extraction and URL resolution pipeline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeSearchA2A } from './a2a-transport.js';

// Mock dependencies
vi.mock('./a2a-lifecycle.js', () => ({
  getServerState: vi.fn(),
  incrementSearchCount: vi.fn(),
}));

vi.mock('./types.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./types.js')>();
  return {
    ...actual,
    SEARCH_MODEL: 'gemini-3-flash-preview',
  };
});

// Mock gemini-cli functions (extractLinks, stripLinks)
vi.mock('./gemini-cli.js', () => ({
  extractLinks: vi.fn(),
  stripLinks: vi.fn(),
}));

// Mock url-resolver
vi.mock('./url-resolver.js', () => ({
  resolveGroundingUrls: vi.fn(),
}));

import { getServerState, incrementSearchCount } from './a2a-lifecycle.js';
import { SEARCH_MODEL } from './types.js';
import { extractLinks, stripLinks } from './gemini-cli.js';
import { resolveGroundingUrls } from './url-resolver.js';

// Global fetch mock
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('executeSearchA2A', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mocks for link processing pipeline
    vi.mocked(extractLinks).mockReturnValue([]);
    vi.mocked(stripLinks).mockImplementation((text) => text);
    vi.mocked(resolveGroundingUrls).mockResolvedValue([]);
    
    // Default: server is running
    vi.mocked(getServerState).mockReturnValue({
      status: 'running',
      port: 41242,
      uptime: 1000,
      searchCount: 0,
      lastError: null,
      exitCode: null,
      stdoutBuffer: [],
      stderrBuffer: [],
    });
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Success Scenarios
  // ============================================================================

  it('completes successful search with SSE stream parsing', async () => {
    // Mock link processing pipeline - return one link to avoid NO_SEARCH warning
    vi.mocked(extractLinks).mockReturnValue([{ title: 'Example', url: 'http://example.com' }]);
    vi.mocked(stripLinks).mockImplementation(() => 'Here is the answer');
    vi.mocked(resolveGroundingUrls).mockResolvedValue([]);
    
    // Mock successful SSE stream
    const mockStream = createSSEStream([
      { state: 'submitted', message: { parts: [{ kind: 'text', text: 'Task received' }] } },
      { state: 'working', message: { parts: [{ kind: 'text', text: 'Searching...' }] } },
      { 
        state: 'input-required', 
        final: true,
        message: { parts: [{ kind: 'text', text: 'Here is the answer' }] }
      },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    const result = await executeSearchA2A('test query');
    
    expect(result.answer).toBe('Here is the answer');
    expect(result.transport).toBe('a2a');
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:41242',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: expect.stringContaining('"method":"message/stream"'),
      })
    );
  });

  it('extracts and resolves source URLs from markdown links', async () => {
    // Mock link extraction to return test links
    vi.mocked(extractLinks).mockReturnValue([
      { title: 'Example Site', url: 'http://example.com' },
      { title: 'Another Site', url: 'http://another.com' },
    ]);
    
    // Mock URL resolution
    vi.mocked(resolveGroundingUrls).mockResolvedValue([
      { title: 'Example Site', original: 'http://example.com', resolved: 'http://example.com', resolvedSuccessfully: true },
      { title: 'Another Site', original: 'http://another.com', resolved: 'http://another.com', resolvedSuccessfully: true },
    ]);
    
    // Mock stripLinks to return cleaned text
    vi.mocked(stripLinks).mockImplementation(() => 'Clean answer without links');
    
    const mockStream = createSSEStream([
      { 
        state: 'input-required', 
        final: true,
        message: { parts: [{ kind: 'text', text: 'Answer with [Example Site](http://example.com) links' }] }
      },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    const result = await executeSearchA2A('test query');
    
    expect(result.answer).toBe('Clean answer without links');
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].title).toBe('Example Site');
    expect(result.sources[0].original).toBe('http://example.com');
    expect(vi.mocked(extractLinks)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveGroundingUrls)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(stripLinks)).toHaveBeenCalledTimes(1);
  });

  it('adds NO_SEARCH warning when no links found', async () => {
    // Mock no links extracted
    vi.mocked(extractLinks).mockReturnValue([]);
    
    const mockStream = createSSEStream([
      { 
        state: 'input-required', 
        final: true,
        message: { parts: [{ kind: 'text', text: 'Answer without any links' }] }
      },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    const result = await executeSearchA2A('test query');
    
    expect(result.warning).toBeDefined();
    expect(result.warning?.type).toBe('NO_SEARCH');
    expect(result.warning?.message).toContain('answered from memory');
  });

  it('filters SSE parts by kind === "text" (not type)', async () => {
    const mockStream = createSSEStream([
      { 
        state: 'input-required', 
        final: true,
        message: { 
          parts: [
            { kind: 'text', text: 'Visible answer' },
            { kind: 'data', data: { request: { name: 'tool' } } },
            // This should be ignored because it uses 'type' instead of 'kind'
            { type: 'text', text: 'Should be ignored' } as any,
          ] 
        } 
      },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    const result = await executeSearchA2A('test query');
    
    expect(result.answer).toBe('Visible answer');
  });

  it('detects task completion with state === "input-required" && final === true', async () => {
    const mockStream = createSSEStream([
      { state: 'submitted', message: { parts: [] } },
      { state: 'working', message: { parts: [] } },
      { state: 'input-required', final: false, message: { parts: [] } }, // Not final yet
      { state: 'input-required', final: true, message: { parts: [{ kind: 'text', text: 'Final answer' }] } },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    const result = await executeSearchA2A('test query');
    
    expect(result.answer).toBe('Final answer');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('calls incrementSearchCount after successful search', async () => {
    const mockStream = createSSEStream([
      { state: 'input-required', final: true, message: { parts: [{ kind: 'text', text: 'Done' }] } },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    await executeSearchA2A('test query');
    
    expect(incrementSearchCount).toHaveBeenCalledTimes(1);
    expect(incrementSearchCount).toHaveBeenCalledAfter(fetchMock);
  });

  it('handles non-YOLO approval flow', async () => {
    // Mock link processing for approval flow test
    vi.mocked(extractLinks).mockReturnValue([]);
    vi.mocked(stripLinks).mockImplementation((text) => text);
    
    // Mock first SSE stream: returns input-required + final: true with tool call
    const mockStream1 = createSSEStreamWithId('task-123', [
      { 
        state: 'input-required', 
        final: true,
        message: { 
          parts: [{ kind: 'data', data: { request: { callId: 'call-456', name: 'google_web_search' } } }] 
        },
        metadata: { coderAgent: { kind: 'tool-call-update' } }
      },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream1,
    });

    // Mock approval response stream: returns actual search results
    const mockStream2 = createSSEStream([
      { 
        state: 'working', 
        message: { parts: [{ kind: 'text', text: 'Based on search...' }] },
        kind: 'text-content'
      },
      { 
        state: 'input-required', 
        final: true,
        message: { parts: [{ kind: 'text', text: 'Final answer' }] },
        kind: 'text-content'
      },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream2,
    });

    const result = await executeSearchA2A('test query');

    // Verify approval POST was sent (second fetch call)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    
    // Verify second call is approval POST
    const approvalCall = fetchMock.mock.calls[1];
    expect(approvalCall[0]).toBe('http://localhost:41242');
    expect(approvalCall[1]?.method).toBe('POST');
    
    const approvalBody = JSON.parse(approvalCall[1]?.body as string);
    expect(approvalBody.method).toBe('message/stream');
    expect(approvalBody.params.taskId).toBe('task-123');
    expect(approvalBody.params.message.parts[0].data.callId).toBe('call-456');
    expect(approvalBody.params.message.parts[0].data.outcome).toBe('proceed_once');

    // Verify result contains approval stream content
    expect(result.answer).toBe('Final answer');
    expect(result.transport).toBe('a2a');
  });

  // ============================================================================
  // Error Scenarios - Connection
  // ============================================================================

  it('throws A2A_CONNECTION_REFUSED when server not running', async () => {
    vi.mocked(getServerState).mockReturnValue({
      status: 'stopped',
      port: 41242,
      uptime: null,
      searchCount: 0,
      lastError: null,
      exitCode: null,
      stdoutBuffer: [],
      stderrBuffer: [],
    });
    
    await expect(executeSearchA2A('test query'))
      .rejects.toMatchObject({
        type: 'A2A_CONNECTION_REFUSED',
        message: expect.stringContaining('not running'),
      });
    
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws A2A_CONNECTION_REFUSED on ECONNREFUSED', async () => {
    const connError = new Error('Connection refused');
    (connError as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    fetchMock.mockRejectedValueOnce(connError);
    
    await expect(executeSearchA2A('test query'))
      .rejects.toMatchObject({
        type: 'A2A_CONNECTION_REFUSED',
        message: expect.stringContaining('Cannot connect'),
      });
  });

  it('throws A2A_HUNG when connection takes too long (>500ms)', async () => {
    // Simulate slow connection by delaying fetch resolution past the 500ms timeout
    fetchMock.mockImplementationOnce(() => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          const abortError = new Error('The operation was aborted');
          (abortError as any).name = 'AbortError';
          reject(abortError);
        }, 1000);
      });
    });
    
    await expect(executeSearchA2A('test query'))
      .rejects.toMatchObject({
        type: 'A2A_HUNG',
        message: expect.stringContaining('timeout'),
      });
  });

  // ============================================================================
  // Error Scenarios - Authentication
  // ============================================================================

  it('throws A2A_AUTH_EXPIRED on 401 response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });
    
    await expect(executeSearchA2A('test query'))
      .rejects.toMatchObject({
        type: 'A2A_AUTH_EXPIRED',
        message: expect.stringContaining('401'),
      });
  });

  // ============================================================================
  // Error Scenarios - Timeout
  // ============================================================================

  it('throws A2A_HUNG on response timeout', async () => {
    // Use 200ms timeout for fast test
    process.env.A2A_RESPONSE_TIMEOUT_MS = '200';
    
    try {
      // Mock fetch to capture the signal
      let capturedSignal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce((_url: string, options?: RequestInit) => {
        capturedSignal = options?.signal as AbortSignal;
        return Promise.resolve({
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => {
                // Wait for abort signal or hang forever
                return new Promise((_, reject) => {
                  const onAbort = () => {
                    reject(new DOMException('The operation was aborted', 'AbortError'));
                  };
                  if (capturedSignal?.aborted) {
                    onAbort();
                  } else {
                    capturedSignal?.addEventListener('abort', onAbort, { once: true });
                  }
                });
              },
            }),
          },
        });
      });
      
      await expect(executeSearchA2A('test query'))
        .rejects.toMatchObject({
          type: 'A2A_HUNG',
          message: expect.stringContaining('timeout'),
        });
    } finally {
      delete process.env.A2A_RESPONSE_TIMEOUT_MS;
    }
  });

  // ============================================================================
  // Error Scenarios - Parse Errors
  // ============================================================================

  it('throws PARSE_ERROR when no response body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: null,
    });
    
    await expect(executeSearchA2A('test query'))
      .rejects.toMatchObject({
        type: 'PARSE_ERROR',
        message: expect.stringContaining('No response body'),
      });
  });

  it('throws PARSE_ERROR when no result extracted from stream', async () => {
    // Stream with no valid result
    const mockStream = createSSEStream([
      { state: 'submitted', message: { parts: [] } },
      { state: 'working', message: { parts: [] } },
      // No input-required/final state
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    await expect(executeSearchA2A('test query'))
      .rejects.toMatchObject({
        type: 'PARSE_ERROR',
        message: expect.stringContaining('stream ended without returning'),
      });
  });

  it('throws SEARCH_FAILED on non-401 HTTP errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    
    await expect(executeSearchA2A('test query'))
      .rejects.toMatchObject({
        type: 'SEARCH_FAILED',
        message: expect.stringContaining('500'),
      });
  });

  // ============================================================================
  // AbortSignal Propagation
  // ============================================================================

  it('propagates AbortSignal cancellation', async () => {
    const controller = new AbortController();
    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
    
    fetchMock.mockImplementationOnce(() => abortPromise);
    
    // Abort after a short delay
    setTimeout(() => controller.abort(), 100);
    
    await expect(executeSearchA2A('test query', { signal: controller.signal }))
      .rejects.toMatchObject({
        type: 'TIMEOUT',
        message: expect.stringContaining('cancelled'),
      });
  });

  // ============================================================================
  // Progress Callbacks
  // ============================================================================

  it('calls onUpdate at correct milestones', async () => {
    const onUpdate = vi.fn();
    const mockStream = createSSEStream([
      { state: 'submitted', message: { parts: [{ kind: 'text', text: 'Received' }] } },
      { state: 'working', message: { parts: [{ kind: 'text', text: 'Working' }] } },
      { state: 'input-required', final: true, message: { parts: [{ kind: 'text', text: 'Done' }] } },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    await executeSearchA2A('test query', { onUpdate });
    
    expect(onUpdate).toHaveBeenCalledWith('Connecting to A2A server…');
    expect(onUpdate).toHaveBeenCalledWith('Task submitted…');
    expect(onUpdate).toHaveBeenCalledWith('Searching…');
    expect(onUpdate).toHaveBeenCalledWith('Complete');
  });

  it('calls onUpdate with tool execution details', async () => {
    // Mock link processing
    vi.mocked(extractLinks).mockReturnValue([]);
    vi.mocked(stripLinks).mockImplementation((text) => text);
    
    const onUpdate = vi.fn();
    const mockStream = createSSEStream([
      { 
        state: 'working', 
        message: { 
          parts: [
            { kind: 'data', data: { request: { name: 'google_web_search', args: {} } } }
          ] 
        } 
      },
      { state: 'input-required', final: true, message: { parts: [{ kind: 'text', text: 'Done' }] } },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    await executeSearchA2A('test query', { onUpdate });
    
    expect(onUpdate).toHaveBeenCalledWith('Tool executing: google_web_search…');
  });

  it('calls onUpdate with URL resolution progress when links found', async () => {
    // Mock link extraction with 3 links
    vi.mocked(extractLinks).mockReturnValue([
      { title: 'Link 1', url: 'http://link1.com' },
      { title: 'Link 2', url: 'http://link2.com' },
      { title: 'Link 3', url: 'http://link3.com' },
    ]);
    vi.mocked(resolveGroundingUrls).mockResolvedValue([]);
    vi.mocked(stripLinks).mockImplementation((text) => text);
    
    const onUpdate = vi.fn();
    const mockStream = createSSEStream([
      { state: 'input-required', final: true, message: { parts: [{ kind: 'text', text: 'Answer' }] } },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    await executeSearchA2A('test query', { onUpdate });
    
    expect(onUpdate).toHaveBeenCalledWith('Resolving 3 source URLs…');
  });

  // ============================================================================
  // Request Format
  // ============================================================================

  it('sends JSON-RPC message/stream with correct structure', async () => {
    // Mock link processing
    vi.mocked(extractLinks).mockReturnValue([]);
    vi.mocked(stripLinks).mockImplementation((text) => text);
    
    const mockStream = createSSEStream([
      { state: 'input-required', final: true, message: { parts: [{ kind: 'text', text: 'OK' }] } },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    await executeSearchA2A('test query');
    
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:41242',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: expect.any(String),
      })
    );
    
    // Verify the request body structure
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(requestBody.jsonrpc).toBe('2.0');
    expect(requestBody.method).toBe('message/stream');
    expect(requestBody.id).toMatch(/^search-[a-f0-9-]+$/); // UUID format
    expect(requestBody.params.message.role).toBe('user');
    expect(requestBody.params.message.parts).toEqual([
      { kind: 'text', text: expect.stringContaining('Use the google_web_search tool to search the web for:') }
    ]);
    expect(requestBody.params.message.messageId).toMatch(/^msg-[a-f0-9-]+$/); // UUID format
    expect(requestBody.params.message.metadata._model).toBe(SEARCH_MODEL);
  });

  it('uses correct prompt instructing Gemini to use google_web_search tool', async () => {
    // Mock link processing
    vi.mocked(extractLinks).mockReturnValue([]);
    vi.mocked(stripLinks).mockImplementation((text) => text);
    
    const mockStream = createSSEStream([
      { state: 'input-required', final: true, message: { parts: [{ kind: 'text', text: 'OK' }] } },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    await executeSearchA2A('What is TypeScript?');
    
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const promptText = requestBody.params.message.parts[0].text;
    expect(promptText).toBe('Use the google_web_search tool to search the web for: What is TypeScript?. Include source URLs.');
  });

  it('uses SEARCH_MODEL constant in message metadata', async () => {
    // Mock link processing
    vi.mocked(extractLinks).mockReturnValue([]);
    vi.mocked(stripLinks).mockImplementation((text) => text);
    
    const mockStream = createSSEStream([
      { state: 'input-required', final: true, message: { parts: [{ kind: 'text', text: 'OK' }] } },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    await executeSearchA2A('test query');
    
    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.params.message.metadata._model).toBe(SEARCH_MODEL);
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  it('handles empty text parts gracefully', async () => {
    const mockStream = createSSEStream([
      { 
        state: 'input-required', 
        final: true,
        message: { parts: [{ kind: 'text', text: '' }] }
      },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    // Empty answer should throw PARSE_ERROR
    await expect(executeSearchA2A('test query'))
      .rejects.toMatchObject({
        type: 'PARSE_ERROR',
        message: expect.stringContaining('Failed to extract answer'),
      });
  });

  it('handles multiple text parts by concatenating', async () => {
    const mockStream = createSSEStream([
      { 
        state: 'input-required', 
        final: true,
        message: { 
          parts: [
            { kind: 'text', text: 'First part ' },
            { kind: 'text', text: 'second part' },
          ] 
        } 
      },
    ]);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    const result = await executeSearchA2A('test query');
    
    expect(result.answer).toBe('First part second part');
  });

  it('ignores malformed SSE events', async () => {
    // Mock link processing
    vi.mocked(extractLinks).mockReturnValue([]);
    vi.mocked(stripLinks).mockImplementation((text) => text);
    
    // Create stream that includes invalid JSON
    const encoder = new TextEncoder();
    const mockStream = {
      getReader: () => {
        let callCount = 0;
        return {
          read: async () => {
            callCount++;
            if (callCount === 1) {
              return {
                done: false,
                value: encoder.encode('data: invalid json\n\n'),
              };
            } else if (callCount === 2) {
              return {
                done: false,
                value: encoder.encode(`data: ${JSON.stringify({ result: { status: { state: 'input-required', message: { parts: [{ kind: 'text', text: 'Valid' }] } }, final: true, metadata: { coderAgent: { kind: 'text-content' } } } })}\n\n`),
              };
            }
            return { done: true, value: undefined };
          },
          cancel: async () => {
            // Mock cancel
          },
        };
      },
    };
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockStream,
    });
    
    const result = await executeSearchA2A('test query');
    
    expect(result.answer).toBe('Valid');
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a mock ReadableStream for SSE events
 */
function createSSEStream(results: Array<{ state: string; final?: boolean; message: { parts: Array<{ kind?: string; type?: string; text?: string; data?: unknown }> }; kind?: string }>) {
  const encoder = new TextEncoder();
  const events = results.map(result => {
    const { final, kind, ...statusData } = result;
    const data = JSON.stringify({
      jsonrpc: '2.0',
      result: {
        status: statusData,
        final, // Put final at result level, not inside status
        metadata: {
          coderAgent: {
            kind: kind || 'text-content', // Default to 'text-content' for answer content
          },
        },
      },
    });
    return `data: ${data}\n\n`;
  });
  
  let index = 0;
  
  return {
    getReader: () => ({
      read: async () => {
        if (index < events.length) {
          const value = encoder.encode(events[index]);
          index++;
          return { done: false, value };
        }
        return { done: true, value: undefined };
      },
      cancel: async () => {
        // Mock cancel - just reset index
        index = 0;
      },
    }),
  } as unknown as ReadableStream<Uint8Array>;
}

/**
 * Creates a mock ReadableStream for SSE events with explicit task ID
 */
function createSSEStreamWithId(taskId: string, results: Array<{ state: string; final?: boolean; message: { parts: Array<{ kind?: string; type?: string; text?: string; data?: unknown }> }; kind?: string; metadata?: unknown }>) {
  const encoder = new TextEncoder();
  const events = results.map(result => {
    const { final, kind, ...statusData } = result;
    const data = JSON.stringify({
      jsonrpc: '2.0',
      id: taskId,
      result: {
        status: statusData,
        final, // Put final at result level, not inside status
        metadata: {
          coderAgent: {
            kind: kind || 'text-content',
          },
        },
      },
    });
    return `data: ${data}\n\n`;
  });
  
  let index = 0;
  
  return {
    getReader: () => ({
      read: async () => {
        if (index < events.length) {
          const value = encoder.encode(events[index]);
          index++;
          return { done: false, value };
        }
        return { done: true, value: undefined };
      },
      cancel: async () => {
        index = 0;
      },
    }),
  } as unknown as ReadableStream<Uint8Array>;
}
