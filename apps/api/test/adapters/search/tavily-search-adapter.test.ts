import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TavilySearchAdapter } from '../../../src/adapters/search/TavilySearchAdapter.js';
import { WebSearchUnavailableError } from '../../../src/domain/chat/errors/web-search-unavailable.error.js';
import type { LlmPort } from '../../../src/domain/ports/llm.port.js';

function fakeLlm(summary = 'a summary'): LlmPort {
  return {
    generateQuiz: vi.fn(),
    chat: vi.fn(),
    summarize: vi.fn().mockResolvedValue(summary),
  } as unknown as LlmPort;
}

describe('TavilySearchAdapter (Story 4.2)', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  const originalMinimax = process.env.MINIMAX_API_KEY;

  beforeEach(() => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    process.env.MINIMAX_API_KEY = 'test-minimax-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.TAVILY_API_KEY = originalKey;
    process.env.MINIMAX_API_KEY = originalMinimax;
    vi.restoreAllMocks();
  });

  it('parses a successful Tavily response, summarizes via LlmPort, and returns only {summary, sources}', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: 'test query',
        results: [
          { title: 'Result A', url: 'https://example.com/a', content: 'raw content A' },
          { title: 'Result B', url: 'https://example.com/b', content: 'raw content B' },
        ],
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const llm = fakeLlm('short summary');
    const adapter = new TavilySearchAdapter(llm);
    const result = await adapter.search('test query', { mainAgentProvider: 'minimax' });

    expect(result.summary).toBe('short summary');
    expect(result.sources).toEqual([
      { title: 'Result A', url: 'https://example.com/a' },
      { title: 'Result B', url: 'https://example.com/b' },
    ]);
    // Raw `content` never appears on the returned object.
    expect(JSON.stringify(result)).not.toContain('raw content');

    // include_raw_content is NEVER true in the outgoing request body.
    const [, requestInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.include_raw_content).toBe(false);
  });

  it('degrades to WebSearchUnavailableError on a non-2xx response — never a raw exception', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    const adapter = new TavilySearchAdapter(fakeLlm());
    await expect(adapter.search('q', { mainAgentProvider: 'minimax' })).rejects.toBeInstanceOf(
      WebSearchUnavailableError,
    );
  });

  it('degrades to WebSearchUnavailableError on a malformed (schema-invalid) response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ not: 'the right shape' }),
    }) as unknown as typeof fetch;
    const adapter = new TavilySearchAdapter(fakeLlm());
    await expect(adapter.search('q', { mainAgentProvider: 'minimax' })).rejects.toBeInstanceOf(
      WebSearchUnavailableError,
    );
  });

  it('degrades to WebSearchUnavailableError on a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
    const adapter = new TavilySearchAdapter(fakeLlm());
    await expect(adapter.search('q', { mainAgentProvider: 'minimax' })).rejects.toBeInstanceOf(
      WebSearchUnavailableError,
    );
  });

  it('hard-caps the returned summary to 200 chars even if the summarizer over-produces', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: 'q',
        results: [{ title: 'T', url: 'https://example.com', content: 'c' }],
      }),
    }) as unknown as typeof fetch;
    const llm = fakeLlm('x'.repeat(500));
    const adapter = new TavilySearchAdapter(llm);
    const result = await adapter.search('q', { mainAgentProvider: 'minimax' });
    expect(result.summary.length).toBeLessThanOrEqual(200);
  });
});
