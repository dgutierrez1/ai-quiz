import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { type SeedQuestionSpec, seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const TOKEN = 'test-maintenance-token-value';

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
  process.env.MAINTENANCE_TOKEN = TOKEN;
  const { createApplication } = await import('../../src/main.js');
  const application = await createApplication();
  await application.listen(0);
  return application;
}

async function postScrub(
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `${await app.getUrl()}/api/maintenance/scrub-chat`;
  const headers: Record<string, string> = {};
  if (token !== undefined) headers['x-maintenance-token'] = token;
  const response = await fetch(url, { method: 'POST', headers });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function insertMessageAt(sessionId: string, ageMs: number): Promise<string> {
  const createdAt = new Date(Date.now() - ageMs).toISOString();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO chat_messages (session_id, role, content, sources, tool_calls, thinking, model, created_at)
     VALUES ($1, 'assistant', 'secret content', '[{"title":"t","url":"https://x.com"}]'::jsonb, '[]'::jsonb, '{"foo":"bar"}'::jsonb, 'MiniMax-M3', $2)
     RETURNING id`,
    [sessionId, createdAt],
  );
  return result.rows[0]!.id;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60_000;

describe('POST /api/maintenance/scrub-chat (Story 4.4)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('missing token: 401, standard error envelope', async () => {
    const result = await postScrub(undefined);
    expect(result.status).toBe(401);
    expect(result.body).toHaveProperty('error.code');
  });

  it('wrong token: 401', async () => {
    const result = await postScrub('not-the-right-token');
    expect(result.status).toBe(401);
  });

  it('correct token: 200', async () => {
    const result = await postScrub(TOKEN);
    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('chatRowsScrubbed');
    expect(result.body).toHaveProperty('cutoff');
  });

  it('boundary: a message 6d23h59m old is untouched; one 7d00h01m old is scrubbed', async () => {
    const seed = await seedQuizSession(pool, `scrub-boundary-${Date.now()}`, QUESTIONS, {
      status: 'ready',
    });
    const freshId = await insertMessageAt(seed.sessionId, SEVEN_DAYS_MS - ONE_MINUTE_MS);
    const staleId = await insertMessageAt(seed.sessionId, SEVEN_DAYS_MS + ONE_MINUTE_MS);

    await postScrub(TOKEN);

    const fresh = await pool.query('SELECT content, scrubbed_at FROM chat_messages WHERE id = $1', [
      freshId,
    ]);
    expect(fresh.rows[0]?.content).toBe('secret content');
    expect(fresh.rows[0]?.scrubbed_at).toBeNull();

    const stale = await pool.query(
      'SELECT content, sources, tool_calls, thinking, scrubbed_at, role, session_id FROM chat_messages WHERE id = $1',
      [staleId],
    );
    expect(stale.rows[0]?.content).toBeNull();
    expect(stale.rows[0]?.sources).toBeNull();
    expect(stale.rows[0]?.tool_calls).toBeNull();
    expect(stale.rows[0]?.thinking).toBeNull();
    expect(stale.rows[0]?.scrubbed_at).not.toBeNull();
    // role/session_id (thread structure) untouched.
    expect(stale.rows[0]?.role).toBe('assistant');
    expect(stale.rows[0]?.session_id).toBe(seed.sessionId);
  });

  it('idempotency: a second run over the same window scrubs 0 additional rows', async () => {
    const seed = await seedQuizSession(pool, `scrub-idempotent-${Date.now()}`, QUESTIONS, {
      status: 'ready',
    });
    await insertMessageAt(seed.sessionId, SEVEN_DAYS_MS + ONE_MINUTE_MS);

    const first = await postScrub(TOKEN);
    const firstCount = (first.body as { chatRowsScrubbed: number }).chatRowsScrubbed;
    expect(firstCount).toBeGreaterThanOrEqual(1);

    const second = await postScrub(TOKEN);
    expect((second.body as { chatRowsScrubbed: number }).chatRowsScrubbed).toBe(0);
  });

  it("cross-user isolation: scrubbing user A's stale rows does not touch user B's fresh rows", async () => {
    const seedA = await seedQuizSession(pool, `scrub-user-a-${Date.now()}`, QUESTIONS, {
      status: 'ready',
    });
    const seedB = await seedQuizSession(pool, `scrub-user-b-${Date.now()}`, QUESTIONS, {
      status: 'ready',
    });
    const staleA = await insertMessageAt(seedA.sessionId, SEVEN_DAYS_MS + ONE_MINUTE_MS);
    const freshB = await insertMessageAt(seedB.sessionId, ONE_MINUTE_MS);

    await postScrub(TOKEN);

    const rowA = await pool.query('SELECT content FROM chat_messages WHERE id = $1', [staleA]);
    expect(rowA.rows[0]?.content).toBeNull();
    const rowB = await pool.query('SELECT content FROM chat_messages WHERE id = $1', [freshB]);
    expect(rowB.rows[0]?.content).toBe('secret content');
  });
});
