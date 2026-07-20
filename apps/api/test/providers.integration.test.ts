import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
let app: INestApplication;

async function startApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.AI_QUIZ_FAKE_ADAPTERS = 'llm,ingestion';
  const { createApplication } = await import('../src/main.js');
  const application = await createApplication();
  await application.listen(0);
  return application;
}

describe('GET /api/config/providers', () => {
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns the v1 provider capability matrix', async () => {
    const response = await fetch(`${await app.getUrl()}/api/config/providers`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { minimax: string[]; openrouter: string[] };
    expect(body.minimax).toContain('MiniMax-M3');
    expect(body.openrouter.length).toBeGreaterThan(0);
  });
});
