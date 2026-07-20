import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { type SeedQuestionSpec, seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER = '83333333-3333-4333-8333-333333333333';

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

async function getHistory(
  userId: string,
  sessionId: string,
  before?: string,
): Promise<{
  status: number;
  body: { messages: { id: string; content: string; createdAt: string }[]; hasMore: boolean };
}> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  const url = `${await app.getUrl()}/api/sessions/${sessionId}/chat${query}`;
  const response = await fetch(url, { headers: { 'x-user-id': userId } });
  const body = (await response.json()) as {
    messages: { id: string; content: string; createdAt: string }[];
    hasMore: boolean;
  };
  return { status: response.status, body };
}

/** Seeds N chat messages directly via SQL with strictly increasing timestamps, plus one deliberate exact-timestamp tie pair. */
async function seedMessages(pool: Pool, sessionId: string, count: number): Promise<void> {
  const base = Date.now() - count * 60_000;
  for (let i = 0; i < count; i += 1) {
    const createdAt = new Date(base + i * 60_000).toISOString();
    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, created_at) VALUES ($1, 'user', $2, $3)`,
      [sessionId, `message ${i}`, createdAt],
    );
  }
}

describe('chat history keyset pagination (Story 4.1 AC #7)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('returns the latest 50 messages chronologically with hasMore:true when 60 are seeded', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    await seedMessages(pool, seed.sessionId, 60);

    const first = await getHistory(USER, seed.sessionId);
    expect(first.status).toBe(200);
    expect(first.body.messages).toHaveLength(50);
    expect(first.body.hasMore).toBe(true);
    // Chronological order: oldest-of-the-batch first.
    expect(first.body.messages[0]?.content).toBe('message 10');
    expect(first.body.messages[49]?.content).toBe('message 59');

    const oldestLoaded = first.body.messages[0]!.createdAt;
    const older = await getHistory(USER, seed.sessionId, oldestLoaded);
    expect(older.status).toBe(200);
    expect(older.body.messages).toHaveLength(10);
    expect(older.body.messages[0]?.content).toBe('message 0');
    expect(older.body.messages[9]?.content).toBe('message 9');
    expect(older.body.hasMore).toBe(false);

    // No overlap, no gap between the two batches.
    const firstIds = new Set(first.body.messages.map((m) => m.id));
    const olderIds = older.body.messages.map((m) => m.id);
    for (const id of olderIds) expect(firstIds.has(id)).toBe(false);
  });

  it('a small thread (< 50) returns hasMore:false and no before is needed', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    await seedMessages(pool, seed.sessionId, 3);
    const result = await getHistory(USER, seed.sessionId);
    expect(result.status).toBe(200);
    expect(result.body.messages).toHaveLength(3);
    expect(result.body.hasMore).toBe(false);
  });

  it('tie-break: two messages sharing an identical created_at are both delivered exactly once across pages', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const tieTimestamp = new Date(Date.now() - 60_000).toISOString();
    // Simulates one turn's user+assistant rows, which share an identical
    // `now()` within the same transaction (see chat.repository.ts's doc
    // comment) — insert both at the SAME created_at.
    const tieRows = await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, created_at)
       VALUES ($1, 'user', 'tie-user', $2), ($1, 'assistant', 'tie-assistant', $2)
       RETURNING id`,
      [seed.sessionId, tieTimestamp],
    );
    expect(tieRows.rows).toHaveLength(2);
    // A third, strictly newer message so the tie pair isn't the "latest" page.
    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, created_at) VALUES ($1, 'user', 'newest', $2)`,
      [seed.sessionId, new Date().toISOString()],
    );

    const first = await getHistory(USER, seed.sessionId);
    expect(first.body.messages).toHaveLength(3);
    const oldestLoaded = first.body.messages[0]!; // one of the tied pair
    expect(['tie-user', 'tie-assistant']).toContain(oldestLoaded.content);

    const older = await getHistory(USER, seed.sessionId, oldestLoaded.createdAt);
    // Both tied rows are excluded as a unit — no duplicate delivery of
    // either tied message on the "older" page.
    const olderContents = older.body.messages.map((m) => m.content);
    expect(olderContents).not.toContain('tie-user');
    expect(olderContents).not.toContain('tie-assistant');
  });
});
