import { getTestDoubles, resetTestDoubles } from '@ai-quiz/test-doubles';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { type SeedQuestionSpec, seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER = '81111111-1111-4111-8111-111111111111';

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
  // Serve the LLM port from the fake so the suite needs no network and no
  // provider credits. Ingestion stays real — this suite seeds sessions
  // directly and never fetches a document.
  process.env.AI_QUIZ_FAKE_ADAPTERS = 'llm';
  const { createApplication } = await import('../../src/main.js');
  const application = await createApplication();
  await application.listen(0);
  return application;
}

async function postChat(
  userId: string,
  sessionId: string,
  content: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `${await app.getUrl()}/api/sessions/${sessionId}/chat`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify({ content }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Seeds a fully-submitted session (user_responses + knowledge_categories + insights), mirroring the RLS/submit test fixtures. */
async function seedSubmittedSession(
  externalUserId: string,
): Promise<{ sessionId: string; questionIds: string[] }> {
  const seed = await seedQuizSession(pool, externalUserId, QUESTIONS, { status: 'ready' });
  await pool.query(`UPDATE quiz_sessions SET status = 'submitted', final_score = 4 WHERE id = $1`, [
    seed.sessionId,
  ]);
  for (const questionId of seed.questionIds) {
    await pool.query(
      `INSERT INTO user_responses (session_id, question_id, selected, raw_score, weight, weighted_score)
       VALUES ($1, $2, '[0]'::jsonb, 4, 1, 4)`,
      [seed.sessionId, questionId],
    );
  }
  for (const name of ['Geography', 'History']) {
    await pool.query(
      `INSERT INTO knowledge_categories (session_id, name, question_count, correct_count, avg_raw_score, weighted_score, strength)
       VALUES ($1, $2, 2, 2, 4, 4, 'strong') ON CONFLICT (session_id, name) DO NOTHING`,
      [seed.sessionId, name],
    );
  }
  await pool.query(
    `INSERT INTO insights (session_id, kind, payload)
     VALUES ($1, 'gap_analysis', '{"topicsToStudy":[],"weakCategories":[],"strengthByCategory":{}}'::jsonb)`,
    [seed.sessionId],
  );
  return { sessionId: seed.sessionId, questionIds: [...seed.questionIds] };
}

describe('chat pre-submit guard (Story 4.1 AD-12)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterEach(() => {
    resetTestDoubles();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('pending session: 409 with currentStatus, no answer content leaked in the response', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'pending' });
    const result = await postChat(USER, seed.sessionId, 'hello');
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: { code: 'CHAT_NOT_AVAILABLE', currentStatus: 'pending' },
    });
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('is_correct');
    expect(serialized).not.toContain('isCorrect');
    expect(serialized.toLowerCase()).not.toContain('question 0 about');
  });

  it('failed session: 409 with currentStatus, no answer content leaked — must not fall through to submitted', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'failed' });
    const result = await postChat(USER, seed.sessionId, 'hello');
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: { code: 'CHAT_NOT_AVAILABLE', currentStatus: 'failed' },
    });
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('is_correct');
    expect(serialized).not.toContain('isCorrect');
  });

  it('ready session: 200, and the LLM only ever receives a redacted systemContext (no text/isCorrect)', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const result = await postChat(USER, seed.sessionId, 'What topics does this quiz cover?');
    expect(result.status).toBe(200);

    const sentParams = getTestDoubles().llm.lastChatParams;
    expect(sentParams).not.toBeNull();
    expect(sentParams!.systemContext).not.toContain('isCorrect');
    expect(sentParams!.systemContext).not.toContain('Question 0 about');
    expect(sentParams!.systemContext).toContain('Geography');
  });

  it('submitted session: 200, and the LLM receives the full context (finalScore + question text + isCorrect)', async () => {
    const submitted = await seedSubmittedSession(USER);
    const result = await postChat(USER, submitted.sessionId, 'Explain question 1');
    expect(result.status).toBe(200);

    const sentParams = getTestDoubles().llm.lastChatParams;
    expect(sentParams).not.toBeNull();
    expect(sentParams!.systemContext).toContain('isCorrect');
    expect(sentParams!.systemContext).toContain('Question 0 about');
    expect(sentParams!.systemContext).toContain('"finalScore"');
  });
});
