import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { type SeedQuestionSpec, seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER_A = '55555555-5555-4555-8555-555555555555';
const USER_B = '66666666-6666-4666-8666-666666666666';

const FIVE_QUESTIONS: SeedQuestionSpec[] = [
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

function completeRequestFor(questionIds: readonly string[]): {
  responses: { questionId: string; selected: number[] }[];
} {
  return { responses: questionIds.map((questionId) => ({ questionId, selected: [0] })) };
}

async function postSubmit(
  userId: string,
  sessionId: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `${await app.getUrl()}/api/sessions/${sessionId}/submit`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('ownership isolation on POST /sessions/:id/submit (Story 3.1)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("returns 404 (not 403) when a non-owner submits against another user's session", async () => {
    const seed = await seedQuizSession(pool, USER_A, FIVE_QUESTIONS, { status: 'ready' });
    const result = await postSubmit(USER_B, seed.sessionId, completeRequestFor(seed.questionIds));
    expect(result.status).toBe(404);
    expect(result.body).toHaveProperty('error.code', 'NOT_FOUND');
  });

  it('returns 404 for a non-owner even when the session is already submitted', async () => {
    const seed = await seedQuizSession(pool, USER_A, FIVE_QUESTIONS, { status: 'ready' });
    const owner = await postSubmit(USER_A, seed.sessionId, completeRequestFor(seed.questionIds));
    expect(owner.status).toBe(200);

    const nonOwner = await postSubmit(USER_B, seed.sessionId, completeRequestFor(seed.questionIds));
    expect(nonOwner.status).toBe(404);
  });

  it('the owner can submit their own ready session and gets a 200', async () => {
    const seed = await seedQuizSession(pool, USER_A, FIVE_QUESTIONS, { status: 'ready' });
    const result = await postSubmit(USER_A, seed.sessionId, completeRequestFor(seed.questionIds));
    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('finalScore');
    expect(result.body).toHaveProperty('sessionId', seed.sessionId);
  });

  it('returns 404 for a submit against a nonexistent session id', async () => {
    const result = await postSubmit(USER_A, '00000000-0000-4000-8000-000000000000', {
      responses: [],
    });
    expect(result.status).toBe(404);
  });
});
