import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { type SeedQuestionSpec, seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER = '86666666-6666-4666-8666-666666666666';
const TOKEN = 'tombstone-read-token';

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

describe('GET /api/sessions/:id/chat renders scrubbed rows as tombstones (Story 4.4 AC #9)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('returns 200 with no Zod parse error, content:null and a set scrubbedAt for a scrubbed row', async () => {
    const seed = await seedQuizSession(pool, USER, QUESTIONS, { status: 'ready' });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, created_at) VALUES ($1, 'assistant', 'old content', $2)`,
      [seed.sessionId, eightDaysAgo],
    );

    const scrubResponse = await fetch(`${await app.getUrl()}/api/maintenance/scrub-chat`, {
      method: 'POST',
      headers: { 'x-maintenance-token': TOKEN },
    });
    expect(scrubResponse.status).toBe(200);

    const historyResponse = await fetch(
      `${await app.getUrl()}/api/sessions/${seed.sessionId}/chat`,
      {
        headers: { 'x-user-id': USER },
      },
    );
    expect(historyResponse.status).toBe(200);
    const body = (await historyResponse.json()) as {
      messages: { content: string | null; scrubbedAt: string | null; role: string }[];
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.content).toBeNull();
    expect(body.messages[0]?.scrubbedAt).not.toBeNull();
    expect(body.messages[0]?.role).toBe('assistant');
  });
});
