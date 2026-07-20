import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { type SeedQuestionSpec, seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER = '82222222-2222-4222-8222-222222222222';

const QUESTIONS: SeedQuestionSpec[] = [
  { type: 'single', category: 'Geography', correctPositions: [0] },
  { type: 'single', category: 'Geography', correctPositions: [1] },
  { type: 'single', category: 'History', correctPositions: [2] },
  { type: 'single', category: 'History', correctPositions: [3] },
  { type: 'single', category: 'History', correctPositions: [0] },
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

async function postChat(
  userId: string,
  sessionId: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `${await app.getUrl()}/api/sessions/${sessionId}/chat`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('chat persistence (Story 4.1 AC #6/#2)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('persists both the user and assistant turns and returns them', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const result = await postChat(USER, seed.sessionId, { content: 'Hello there' });
    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('userMessage.role', 'user');
    expect(result.body).toHaveProperty('userMessage.content', 'Hello there');
    expect(result.body).toHaveProperty('assistantMessage.role', 'assistant');
    expect(
      typeof (result.body as { assistantMessage: { content: string } }).assistantMessage.content,
    ).toBe('string');

    const rows = await pool.query(
      'SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at',
      [seed.sessionId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.role).toBe('user');
    expect(rows.rows[1]?.role).toBe('assistant');
  });

  it('enforces content <= 8000 chars at the Zod boundary — 8001 chars is rejected with 400', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const tooLong = 'a'.repeat(8001);
    const result = await postChat(USER, seed.sessionId, { content: tooLong });
    expect(result.status).toBe(400);
  });

  it('accepts exactly 8000 chars', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const exact = 'a'.repeat(8000);
    const result = await postChat(USER, seed.sessionId, { content: exact });
    expect(result.status).toBe(200);
  });

  it('rejects an empty content string with 400', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const result = await postChat(USER, seed.sessionId, { content: '' });
    expect(result.status).toBe(400);
  });

  it('rejects a request carrying a questionId field — the schema is .strict()', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const result = await postChat(USER, seed.sessionId, {
      content: 'hi',
      questionId: seed.questionIds[0],
    });
    expect(result.status).toBe(400);
  });

  it('the chat_messages table has no question_id column at all', async () => {
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'chat_messages'`,
    );
    const names = columns.rows.map((row: { column_name: string }) => row.column_name);
    expect(names).not.toContain('question_id');
  });
});
