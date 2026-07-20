import { afterEach, describe, expect, it, vi } from 'vitest';

import { LangfuseAdapter } from '../../src/adapters/observability/langfuse.adapter.js';
import { NoopTracingAdapter } from '../../src/adapters/observability/noop-tracing.adapter.js';
import { hashUserId } from '../../src/adapters/observability/observability.module.js';

const CONFIG = {
  publicKey: 'pk-test-public',
  secretKey: 'sk-test-secret',
  baseUrl: 'https://langfuse.example.com',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NoopTracingAdapter (no credentials configured)', () => {
  it('accepts traces silently and reports nothing deleted', async () => {
    const adapter = new NoopTracingAdapter();
    await expect(
      adapter.recordGeneration({ name: 'generate-quiz', provider: 'minimax', model: 'MiniMax-M3' }),
    ).resolves.toBeUndefined();
    await expect(adapter.flush()).resolves.toBeUndefined();
    await expect(adapter.deleteTracesOlderThan(new Date())).resolves.toEqual({ deletedCount: 0 });
  });
});

describe('LangfuseAdapter', () => {
  it('emits a generation trace and flushes it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new LangfuseAdapter(CONFIG);
    await adapter.recordGeneration({
      name: 'generate-quiz',
      provider: 'minimax',
      model: 'MiniMax-M3',
      latencyMs: 1234,
      sessionId: 'session-1',
      userIdHash: hashUserId('11111111-1111-4111-8111-111111111111'),
    });
    await adapter.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://langfuse.example.com/api/public/ingestion');
    const body = JSON.parse((init as { body: string }).body) as {
      batch: { body: { name: string; metadata: Record<string, unknown> } }[];
    };
    expect(body.batch[0]!.body.name).toBe('generate-quiz');
    expect(body.batch[0]!.body.metadata.sessionId).toBe('session-1');
  });

  it('never lets a tracing outage surface as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('langfuse unreachable')));

    const adapter = new LangfuseAdapter(CONFIG);
    await expect(
      adapter.recordGeneration({ name: 'chat', provider: 'minimax', model: 'MiniMax-M3' }),
    ).resolves.toBeUndefined();
    // The whole point: a dead tracing backend must not reject into a use-case.
    await expect(adapter.flush()).resolves.toBeUndefined();
  });

  it('carries a hashed user id and never the raw identifier', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const rawUserId = '11111111-1111-4111-8111-111111111111';
    const adapter = new LangfuseAdapter(CONFIG);
    await adapter.recordGeneration({
      name: 'generate-quiz',
      provider: 'minimax',
      model: 'MiniMax-M3',
      userIdHash: hashUserId(rawUserId),
    });
    await adapter.flush();

    const serialized = (fetchMock.mock.calls[0]![1] as { body: string }).body;
    expect(serialized).not.toContain(rawUserId);
    expect(serialized).toContain(hashUserId(rawUserId));
  });

  it('never serializes the API credentials into the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new LangfuseAdapter(CONFIG);
    await adapter.recordGeneration({ name: 'chat', provider: 'minimax', model: 'MiniMax-M3' });
    await adapter.flush();

    const serialized = (fetchMock.mock.calls[0]![1] as { body: string }).body;
    expect(serialized).not.toContain(CONFIG.secretKey);
    expect(serialized).not.toContain(CONFIG.publicKey);
  });

  it('sweeps traces older than the cutoff in bounded batches', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => ({ id: `trace-${i}` }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ids }) })
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new LangfuseAdapter(CONFIG);
    const cutoff = new Date('2026-07-13T00:00:00.000Z');
    const result = await adapter.deleteTracesOlderThan(cutoff);

    expect(result.deletedCount).toBe(45);
    // 1 list call + 2 delete batches (30 + 15).
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(encodeURIComponent(cutoff.toISOString()));
  });
});

describe('hashUserId', () => {
  it('is deterministic and does not echo the input', () => {
    const raw = '22222222-2222-4222-8222-222222222222';
    const hashed = hashUserId(raw);
    expect(hashed).toBe(hashUserId(raw));
    expect(hashed).not.toContain(raw);
    expect(hashed).toHaveLength(64);
  });
});
