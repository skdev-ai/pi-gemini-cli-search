/**
 * Unit tests for the cold spawn adapter.
 * 
 * Verifies that executeSearchCold():
 * - Wraps executeSearch correctly
 * - Adds transport:'cold' metadata
 * - Uses SEARCH_MODEL as default
 * - Forwards all options correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeSearchCold } from './cold-spawn.js';
import { SEARCH_MODEL } from './types.js';
import * as geminiCli from './gemini-cli.js';

// Mock the gemini-cli module
vi.mock('./gemini-cli.js', () => ({
  executeSearch: vi.fn(),
}));

describe('executeSearchCold', () => {
  const mockResult = {
    answer: 'Test answer',
    sources: [
      {
        title: 'Example',
        original: 'https://example.com',
        resolved: 'https://example.com',
        resolvedSuccessfully: true,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls executeSearch with the query', async () => {
    vi.mocked(geminiCli.executeSearch).mockResolvedValue(mockResult);

    await executeSearchCold('test query');

    expect(geminiCli.executeSearch).toHaveBeenCalledWith(
      'test query',
      expect.objectContaining({
        model: SEARCH_MODEL,
      })
    );
  });

  it('adds transport:"cold" to the returned result', async () => {
    vi.mocked(geminiCli.executeSearch).mockResolvedValue(mockResult);

    const result = await executeSearchCold('test query');

    expect(result.transport).toBe('cold');
    expect(result.answer).toBe(mockResult.answer);
    expect(result.sources).toEqual(mockResult.sources);
  });

  it('uses SEARCH_MODEL when no model is specified in options', async () => {
    vi.mocked(geminiCli.executeSearch).mockResolvedValue(mockResult);

    await executeSearchCold('test query', {});

    expect(geminiCli.executeSearch).toHaveBeenCalledWith(
      'test query',
      expect.objectContaining({
        model: SEARCH_MODEL,
      })
    );
  });

  it('uses provided model from options instead of SEARCH_MODEL', async () => {
    vi.mocked(geminiCli.executeSearch).mockResolvedValue(mockResult);
    const customModel = 'gemini-2.5-pro';

    await executeSearchCold('test query', { model: customModel });

    expect(geminiCli.executeSearch).toHaveBeenCalledWith(
      'test query',
      expect.objectContaining({
        model: customModel,
      })
    );
  });

  it('forwards AbortSignal correctly', async () => {
    vi.mocked(geminiCli.executeSearch).mockResolvedValue(mockResult);
    const abortController = new AbortController();

    await executeSearchCold('test query', { signal: abortController.signal });

    expect(geminiCli.executeSearch).toHaveBeenCalledWith(
      'test query',
      expect.objectContaining({
        signal: abortController.signal,
      })
    );
  });

  it('forwards onUpdate callback correctly', async () => {
    vi.mocked(geminiCli.executeSearch).mockResolvedValue(mockResult);
    const onUpdateMock = vi.fn();

    await executeSearchCold('test query', { onUpdate: onUpdateMock });

    expect(geminiCli.executeSearch).toHaveBeenCalledWith(
      'test query',
      expect.objectContaining({
        onUpdate: onUpdateMock,
      })
    );
  });

  it('forwards timeout option correctly', async () => {
    vi.mocked(geminiCli.executeSearch).mockResolvedValue(mockResult);
    const timeout = 30000;

    await executeSearchCold('test query', { timeout });

    expect(geminiCli.executeSearch).toHaveBeenCalledWith(
      'test query',
      expect.objectContaining({
        timeout,
      })
    );
  });

  it('forwards all options together correctly', async () => {
    vi.mocked(geminiCli.executeSearch).mockResolvedValue(mockResult);
    const abortController = new AbortController();
    const onUpdateMock = vi.fn();
    const timeout = 45000;
    const customModel = 'gemini-2.5-flash';

    await executeSearchCold('test query', {
      model: customModel,
      timeout,
      signal: abortController.signal,
      onUpdate: onUpdateMock,
    });

    expect(geminiCli.executeSearch).toHaveBeenCalledWith(
      'test query',
      expect.objectContaining({
        model: customModel,
        timeout,
        signal: abortController.signal,
        onUpdate: onUpdateMock,
      })
    );
  });

  it('preserves error results from executeSearch', async () => {
    const mockErrorResult = {
      answer: '',
      sources: [],
      error: {
        type: 'TIMEOUT' as const,
        message: 'Search timed out',
      },
    };
    vi.mocked(geminiCli.executeSearch).mockResolvedValue(mockErrorResult);

    const result = await executeSearchCold('test query');

    expect(result.transport).toBe('cold');
    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('TIMEOUT');
  });

  it('preserves warning results from executeSearch', async () => {
    const mockWarningResult = {
      answer: 'Test answer',
      sources: [],
      warning: {
        type: 'NO_SEARCH' as const,
        message: 'Gemini may have answered from memory',
      },
    };
    vi.mocked(geminiCli.executeSearch).mockResolvedValue(mockWarningResult);

    const result = await executeSearchCold('test query');

    expect(result.transport).toBe('cold');
    expect(result.warning).toBeDefined();
    expect(result.warning?.type).toBe('NO_SEARCH');
  });
});
