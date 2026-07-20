import { geometricWeights, weightedFinalScore } from '@ai-quiz/shared';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { type SeedQuestionSpec, seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER = '77777777-7777-4777-8777-777777777777';

const QUESTIONS: SeedQuestionSpec[] = [
  { type: 'single', category: 'Networking', correctPositions: [0] },
  { type: 'single', category: 'Networking', correctPositions: [1] },
  { type: 'single', category: 'Security', correctPositions: [2] },
  { type: 'single', category: 'Security', correctPositions: [3] },
  { type: 'single', category: 'Security', correctPositions: [0] },
];
// Selections chosen so Networking scores 4/4 (strong) and Security scores
// 0,0,4 -> avgRawScore 1.333 (weak, < 1.6) — exercises both branches of
// `strengthFor` and the weak-category insight/materialization paths.
const SELECTIONS = [0, 1, 0, 0, 0];
const CHUNKS = [
  'This section covers security hardening, firewalls, and access control policies in depth.',
  'This section covers basic networking concepts like IP addressing and routing.',
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

function completeRequest(questionIds: readonly string[]): {
  responses: { questionId: string; selected: number[] }[];
} {
  return {
    responses: questionIds.map((questionId, index) => ({
      questionId,
      selected: [SELECTIONS[index]!],
    })),
  };
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

describe('POST /api/sessions/:id/submit (Story 3.1)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('scores a complete submission, persists rows, and returns the full result shape', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready', chunks: CHUNKS });
    const result = await postSubmit(USER, seed.sessionId, completeRequest(seed.questionIds));

    expect(result.status).toBe(200);
    const body = result.body as {
      sessionId: string;
      finalScore: number;
      breakdown: {
        questionId: string;
        position: number;
        rawScore: number;
        selected: number[];
      }[];
      categoryBreakdown: { name: string; avgRawScore: number; strength: string }[];
      insights: {
        weakCategories: string[];
        topicsToStudy: { topic: string; docSnippets: string[] }[];
        strengthByCategory: Record<string, string>;
      };
    };

    expect(body.sessionId).toBe(seed.sessionId);
    expect(body.breakdown).toHaveLength(5);
    expect(body.breakdown.map((b) => b.rawScore)).toEqual([4, 4, 0, 0, 4]);
    // breakdown is sorted ascending by position.
    expect(body.breakdown.map((b) => b.position)).toEqual([0, 1, 2, 3, 4]);
    // Each breakdown row carries the user's own selections so the FE
    // results page can render the "Your selection" tag per answer.
    expect(body.breakdown.map((b) => b.selected)).toEqual([
      [SELECTIONS[0]!],
      [SELECTIONS[1]!],
      [SELECTIONS[2]!],
      [SELECTIONS[3]!],
      [SELECTIONS[4]!],
    ]);

    const expectedFinalScore = weightedFinalScore(
      body.breakdown.map((b, i) => ({ rawScore: [4, 4, 0, 0, 4][i]!, position: i })),
    );
    expect(body.finalScore).toBe(expectedFinalScore);
    expect(geometricWeights(5)).toHaveLength(5); // sanity: shared module reachable

    const networking = body.categoryBreakdown.find((c) => c.name === 'Networking');
    const security = body.categoryBreakdown.find((c) => c.name === 'Security');
    expect(networking).toMatchObject({ avgRawScore: 4, strength: 'strong' });
    expect(security?.strength).toBe('weak');
    expect(security?.avgRawScore).toBeCloseTo(1.33, 1);

    expect(body.insights.weakCategories).toEqual(['Security']);
    expect(body.insights.strengthByCategory).toMatchObject({
      Networking: 'strong',
      Security: 'weak',
    });
    const securityTopic = body.insights.topicsToStudy.find((t) => t.topic === 'Security');
    expect(securityTopic?.docSnippets.length).toBeGreaterThan(0);

    // Persisted rows.
    const responses = await pool.query('SELECT * FROM user_responses WHERE session_id = $1', [
      seed.sessionId,
    ]);
    expect(responses.rows).toHaveLength(5);
    const categories = await pool.query(
      'SELECT * FROM knowledge_categories WHERE session_id = $1 ORDER BY name',
      [seed.sessionId],
    );
    expect(categories.rows).toHaveLength(2);
    const insightsRows = await pool.query('SELECT * FROM insights WHERE session_id = $1', [
      seed.sessionId,
    ]);
    expect(insightsRows.rows).toHaveLength(1);

    const sessionRow = await pool.query(
      'SELECT status, final_score, completed_at FROM quiz_sessions WHERE id = $1',
      [seed.sessionId],
    );
    expect(sessionRow.rows[0]?.status).toBe('submitted');
    expect(typeof sessionRow.rows[0]?.final_score).toBe('number');
    expect(sessionRow.rows[0]?.completed_at).not.toBeNull();
  });

  it('a second identical POST (idempotent retry) returns a byte-identical body and does not duplicate rows', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready', chunks: CHUNKS });
    const first = await postSubmit(USER, seed.sessionId, completeRequest(seed.questionIds));
    const second = await postSubmit(USER, seed.sessionId, completeRequest(seed.questionIds));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const categories = await pool.query(
      'SELECT * FROM knowledge_categories WHERE session_id = $1',
      [seed.sessionId],
    );
    expect(categories.rows).toHaveLength(2);
    const responses = await pool.query('SELECT * FROM user_responses WHERE session_id = $1', [
      seed.sessionId,
    ]);
    expect(responses.rows).toHaveLength(5);
    const insightsRows = await pool.query('SELECT * FROM insights WHERE session_id = $1', [
      seed.sessionId,
    ]);
    expect(insightsRows.rows).toHaveLength(1);
  });

  it('concurrent submits against the same ready session: one wins, both 200, identical bodies, no 5xx', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready', chunks: CHUNKS });
    const body = completeRequest(seed.questionIds);

    const [a, b] = await Promise.all([
      postSubmit(USER, seed.sessionId, body),
      postSubmit(USER, seed.sessionId, body),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);

    const categories = await pool.query(
      'SELECT * FROM knowledge_categories WHERE session_id = $1',
      [seed.sessionId],
    );
    expect(categories.rows).toHaveLength(2);
    const responses = await pool.query('SELECT * FROM user_responses WHERE session_id = $1', [
      seed.sessionId,
    ]);
    expect(responses.rows).toHaveLength(5);
  });

  it('returns 409 with the current status for a pending session', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'pending' });
    const result = await postSubmit(USER, seed.sessionId, { responses: [] });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: { code: 'SESSION_NOT_READY', status: 'pending' } });
  });

  it('returns 409 with the current status for a failed session', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'failed' });
    const result = await postSubmit(USER, seed.sessionId, { responses: [] });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: { code: 'SESSION_NOT_READY', status: 'failed' } });
  });

  it('rejects an empty selected array with 400 at the Zod boundary', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const request = completeRequest(seed.questionIds);
    request.responses[0]!.selected = [];
    const result = await postSubmit(USER, seed.sessionId, request);
    expect(result.status).toBe(400);
  });

  it('rejects a submission missing a question id with 400', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const request = completeRequest(seed.questionIds);
    request.responses.pop();
    const result = await postSubmit(USER, seed.sessionId, request);
    expect(result.status).toBe(400);
    expect(result.body).toHaveProperty('error.code', 'INCOMPLETE_SUBMISSION');
  });

  it('rejects a submission with an extra/unknown question id with 400', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const request = completeRequest(seed.questionIds);
    request.responses.push({ questionId: '99999999-9999-4999-8999-999999999999', selected: [0] });
    const result = await postSubmit(USER, seed.sessionId, request);
    expect(result.status).toBe(400);
    expect(result.body).toHaveProperty('error.code', 'INCOMPLETE_SUBMISSION');
  });
});
