import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { type SeedQuestionSpec, seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER_A = '84444444-4444-4444-8444-444444444444';
const USER_B = '85555555-5555-4555-8555-555555555555';

const QUESTIONS: SeedQuestionSpec[] = [
  { type: 'single', category: 'Cat A', correctPositions: [0] },
  { type: 'single', category: 'Cat A', correctPositions: [1] },
  { type: 'single', category: 'Cat A', correctPositions: [2] },
  { type: 'single', category: 'Cat A', correctPositions: [3] },
  { type: 'single', category: 'Cat A', correctPositions: [0] },
];

let app: INestApplication;
let pool: Pool;

async function startApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.AI_QUIZ_FAKE_ADAPTERS = 'llm,ingestion';
  const { createApplication } = await import('../../src/main.js');
  const application = await createApplication();
  await application.listen(0);
  return application;
}

async function postChat(userId: string, sessionId: string): Promise<{ status: number }> {
  const url = `${await app.getUrl()}/api/sessions/${sessionId}/chat`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify({ content: 'hello' }),
  });
  return { status: response.status };
}

async function getChat(userId: string, sessionId: string): Promise<{ status: number }> {
  const url = `${await app.getUrl()}/api/sessions/${sessionId}/chat`;
  const response = await fetch(url, { headers: { 'x-user-id': userId } });
  return { status: response.status };
}

describe('ownership isolation on /sessions/:id/chat (Story 4.1 AC #8)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("POST: returns 404 (not 403) when a non-owner chats on another user's session", async () => {
    const seed = await seedQuizSession(pool, USER_A, QUESTIONS, { status: 'ready' });
    const result = await postChat(USER_B, seed.sessionId);
    expect(result.status).toBe(404);
  });

  it("GET: returns 404 (not 403) when a non-owner reads another user's chat history", async () => {
    const seed = await seedQuizSession(pool, USER_A, QUESTIONS, { status: 'ready' });
    await postChat(USER_A, seed.sessionId);
    const result = await getChat(USER_B, seed.sessionId);
    expect(result.status).toBe(404);
  });

  it('the owner can chat on their own session and gets a 200', async () => {
    const seed = await seedQuizSession(pool, USER_A, QUESTIONS, { status: 'ready' });
    const result = await postChat(USER_A, seed.sessionId);
    expect(result.status).toBe(200);
  });

  it('returns 404 for chat against a nonexistent session id', async () => {
    const result = await postChat(USER_A, '00000000-0000-4000-8000-000000000000');
    expect(result.status).toBe(404);
  });
});
