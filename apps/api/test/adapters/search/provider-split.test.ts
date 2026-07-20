import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chooseSummarizerProvider,
  getConfiguredProviderIds,
  TavilySearchAdapter,
} from '../../../src/adapters/search/TavilySearchAdapter.js';
import type { LlmPort } from '../../../src/domain/ports/llm.port.js';

describe('getConfiguredProviderIds / chooseSummarizerProvider (Story 4.2 AC #3/#12)', () => {
  const originalMinimax = process.env.MINIMAX_API_KEY;
  const originalOpenrouter = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    process.env.MINIMAX_API_KEY = originalMinimax;
    process.env.OPENROUTER_API_KEY = originalOpenrouter;
  });

  it('returns [] / [minimax] / [minimax, openrouter] per env-var combination', () => {
    delete process.env.MINIMAX_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    expect(getConfiguredProviderIds()).toEqual([]);

    process.env.MINIMAX_API_KEY = 'key';
    expect(getConfiguredProviderIds()).toEqual(['minimax']);

    process.env.OPENROUTER_API_KEY = 'key2';
    expect(getConfiguredProviderIds()).toEqual(['minimax', 'openrouter']);
  });

  it('multi-provider branch: the summarizer runs on the provider that is NOT the main agent', () => {
    process.env.MINIMAX_API_KEY = 'a';
    process.env.OPENROUTER_API_KEY = 'b';
    expect(chooseSummarizerProvider('minimax')).toBe('openrouter');
    expect(chooseSummarizerProvider('openrouter')).toBe('minimax');
  });

  it('single-provider branch: the summarizer runs on the same provider as the main agent', () => {
    process.env.MINIMAX_API_KEY = 'a';
    delete process.env.OPENROUTER_API_KEY;
    expect(chooseSummarizerProvider('minimax')).toBe('minimax');
  });

  it('single-provider branch is structurally a summarize() call, not chat() with tools stripped', async () => {
    process.env.MINIMAX_API_KEY = 'a';
    delete process.env.OPENROUTER_API_KEY;

    const summarize = vi.fn().mockResolvedValue('summary');
    const chatSpy = vi.fn();
    const llm: LlmPort = {
      generateQuiz: vi.fn(),
      chat: chatSpy,
      summarize,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: 'q',
        results: [{ title: 'T', url: 'https://example.com', content: 'c' }],
      }),
    }) as unknown as typeof fetch;
    process.env.TAVILY_API_KEY = 'tvly-test';

    const adapter = new TavilySearchAdapter(llm);
    await adapter.search('q', { mainAgentProvider: 'minimax' });

    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({ provider: 'minimax' }));
    expect(chatSpy).not.toHaveBeenCalled();

    delete process.env.TAVILY_API_KEY;
  });
});
