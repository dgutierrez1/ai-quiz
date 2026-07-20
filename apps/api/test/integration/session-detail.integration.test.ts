// apps/api/test/integration/session-detail.integration.test.ts
//
// Regression test for the confirmed bug: `GET /api/sessions/:id` used to
// always return the generation-shaped response regardless of session
// status, never merging Story 3.1's submitted-session results — so the web
// `ResultPageClient` got `finalScore: undefined` and `ScoreDisplay` threw
// on `.toFixed()`, unmounting the whole results panel and failing
// `full-quiz.spec.ts`.
//
// Asserts, per status:
//   - `ready`   -> questions WITHOUT `isCorrect` on any answer (security
//                  boundary — never leak the answer key pre-submit).
//   - `submitted` -> finalScore, breakdown[], categoryBreakdown[],
//                  insights{topicsToStudy[],weakCategories[],strengthByCategory},
//                  AND questions WITH `isCorrect` revealed (needed by the
//                  results breakdown UI) — reusing Story 3.1's submit read
//                  model (`SubmissionRepository.getSubmittedResult` /
//                  `findQuestionsWithAnswersForUser`), never re-scored here.
//   - `pending` / `failed` -> status + errorMessage, no questions.

import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { type SeedQuestionSpec, seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER = '88888888-8888-4888-8888-888888888888';

const QUESTIONS: SeedQuestionSpec[] = [
  { type: 'single', category: 'Networking', correctPositions: [0] },
  { type: 'single', category: 'Networking', correctPositions: [1] },
  { type: 'single', category: 'Security', correctPositions: [2] },
  { type: 'single', category: 'Security', correctPositions: [3] },
  { type: 'single', category: 'Security', correctPositions: [0] },
];
const SELECTIONS = [0, 1, 0, 0, 0];

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

async function getSession(
  userId: string,
  sessionId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `${await app.getUrl()}/api/sessions/${sessionId}`;
  const response = await fetch(url, { headers: { 'x-user-id': userId } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function postSubmit(
  userId: string,
  sessionId: string,
  questionIds: readonly string[],
): Promise<void> {
  const url = `${await app.getUrl()}/api/sessions/${sessionId}/submit`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify({
      responses: questionIds.map((questionId, index) => ({
        questionId,
        selected: [SELECTIONS[index]!],
      })),
    }),
  });
  if (!response.ok) throw new Error(`seed submit failed: ${response.status}`);
}

describe('GET /api/sessions/:id (bug fix — status-dependent response)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('ready: returns questions with isCorrect stripped from every answer', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const result = await getSession(USER, seed.sessionId);

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('ready');
    const questions = result.body.questions as { answers: Record<string, unknown>[] }[];
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      for (const answer of question.answers) {
        expect(answer).not.toHaveProperty('isCorrect');
      }
    }
    // No result-only fields leak onto a not-yet-submitted session.
    expect(result.body).not.toHaveProperty('finalScore');
    expect(result.body).not.toHaveProperty('breakdown');
  });

  it('submitted: merges the persisted results with the full question/answer set (isCorrect revealed)', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    await postSubmit(USER, seed.sessionId, seed.questionIds);

    const result = await getSession(USER, seed.sessionId);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('submitted');

    // The exact fields ScoreDisplay / ResultsPanel / InsightsPanel need.
    expect(typeof result.body.finalScore).toBe('number');
    const breakdown = result.body.breakdown as unknown[];
    expect(breakdown).toHaveLength(5);
    // Each breakdown row carries the user's own selections (hydrated from
    // `user_responses.selected`) so the FE can render the "Your
    // selection" tag without a second round-trip.
    expect(
      (result.body.breakdown as { selected: readonly number[] }[]).map((b) => b.selected),
    ).toEqual([
      [SELECTIONS[0]!],
      [SELECTIONS[1]!],
      [SELECTIONS[2]!],
      [SELECTIONS[3]!],
      [SELECTIONS[4]!],
    ]);
    const categoryBreakdown = result.body.categoryBreakdown as { name: string; strength: string }[];
    expect(categoryBreakdown.length).toBeGreaterThan(0);
    const insights = result.body.insights as {
      topicsToStudy: unknown[];
      weakCategories: string[];
      strengthByCategory: Record<string, string>;
    };
    expect(insights).toHaveProperty('topicsToStudy');
    expect(insights).toHaveProperty('weakCategories');
    expect(insights).toHaveProperty('strengthByCategory');

    // Post-submit, isCorrect IS revealed (the breakdown UI needs it) —
    // opposite of the ready-state assertion above.
    const questions = result.body.questions as { answers: { isCorrect: boolean }[] }[];
    expect(questions).toHaveLength(5);
    for (const question of questions) {
      expect(question.answers.some((a) => a.isCorrect === true)).toBe(true);
      for (const answer of question.answers) {
        expect(typeof answer.isCorrect).toBe('boolean');
      }
    }
  });

  it('pending: returns status only, no questions, no result fields', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'pending' });
    const result = await getSession(USER, seed.sessionId);

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('pending');
    expect(result.body.questions).toEqual([]);
    expect(result.body).not.toHaveProperty('finalScore');
  });

  it('failed: returns status + errorMessage, no questions', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'failed' });
    const result = await getSession(USER, seed.sessionId);

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('failed');
    expect(result.body.questions).toEqual([]);
    expect(result.body).not.toHaveProperty('finalScore');
  });
});
