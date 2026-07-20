import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LlmAdapter } from '../../src/adapters/llm/llm.adapter.js';
import { LlmNotConfiguredError } from '../../src/adapters/llm/llm-not-configured.error.js';

/**
 * The regression test for the defect this whole refactor exists to close.
 *
 * The adapter used to answer a missing API key by returning a deterministic
 * mock pool. In production that meant a typo'd or expired key produced a
 * completely normal-looking 201 full of invented questions, presented to the
 * user as grounded in their document. Nothing in the response revealed it.
 *
 * A missing key must therefore produce an error — never content. If someone
 * later reintroduces a mock fallback "just for convenience", this fails.
 */

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER = '99999999-9999-4999-8999-999999999999';

let app: INestApplication;
const originals: Record<string, string | undefined> = {};

function stashAndClear(key: string): void {
  originals[key] = process.env[key];
  delete process.env[key];
}

function restore(key: string): void {
  const value = originals[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('a missing provider key produces an error, never fabricated content', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = LOCAL_DATABASE_URL;
    process.env.NODE_ENV = 'test';
    // The LLM port stays REAL with no key — the exact configuration a
    // misconfigured production deploy has. Ingestion is faked deliberately:
    // otherwise the request 400s at document fetch and never reaches the LLM,
    // so the assertion below would pass for entirely the wrong reason.
    originals['AI_QUIZ_FAKE_ADAPTERS'] = process.env.AI_QUIZ_FAKE_ADAPTERS;
    process.env.AI_QUIZ_FAKE_ADAPTERS = 'ingestion';
    stashAndClear('MINIMAX_API_KEY');
    stashAndClear('OPENROUTER_API_KEY');
    const { createApplication } = await import('../../src/main.js');
    app = await createApplication();
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
    restore('AI_QUIZ_FAKE_ADAPTERS');
    restore('MINIMAX_API_KEY');
    restore('OPENROUTER_API_KEY');
  });

  it('the adapter throws LlmNotConfiguredError rather than returning a pool', async () => {
    const adapter = new LlmAdapter();
    await expect(
      adapter.generateQuiz({
        provider: 'minimax',
        model: 'MiniMax-M3',
        prompt: 'some document text',
        poolSize: 8,
        allowFallback: false,
      }),
    ).rejects.toBeInstanceOf(LlmNotConfiguredError);
  });

  it('chat and summarize fail the same way — no method degrades to a mock', async () => {
    const adapter = new LlmAdapter();
    await expect(
      adapter.chat({
        provider: 'minimax',
        model: 'MiniMax-M3',
        systemContext: 'system',
        history: [],
        userMessage: 'hello',
        allowFallback: true,
      }),
    ).rejects.toBeInstanceOf(LlmNotConfiguredError);

    await expect(
      adapter.summarize({ text: 'some web content', provider: 'minimax' }),
    ).rejects.toBeInstanceOf(LlmNotConfiguredError);
  });

  it('POST /api/sessions returns a 5xx, and its body carries no generated questions', async () => {
    const response = await fetch(`${await app.getUrl()}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': USER },
      body: JSON.stringify({ sourceUrl: 'https://example.com/doc.md', questionCount: 8 }),
    });

    // The critical assertion: NOT a 201. A 201 here means fabricated content
    // reached the user.
    expect(response.status).not.toBe(201);
    expect(response.status).toBeGreaterThanOrEqual(500);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.questions).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('question 1');
  });
});
