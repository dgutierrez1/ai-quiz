// apps/api/test/integration/sessions-list.integration.test.ts
//
// Story 5.1 Task 10 — `GET /api/sessions` (list): ordering (newest first),
// pagination (`limit`/`before`/`hasMore` correctness across 3+ pages), and
// user-scoping (user B never sees user A's rows). Drives the real HTTP
// surface, real Postgres — same pattern as `submit.integration.test.ts`.

import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { seedSessionRow, seedUser } from '../helpers/seed-session-row.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';

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

interface SessionSummaryBody {
  readonly id: string;
  readonly sourceUrl: string;
  readonly status: string;
  readonly createdAt: string;
}

/**
 * @param externalId the caller's `X-User-Id` — the same external id passed
 * to `seedUser` when the fixture rows were created, NOT the internal
 * `users.id` `seedUser` returns.
 */
async function getSessions(
  externalId: string,
  query: string,
): Promise<{
  status: number;
  body: { sessions: SessionSummaryBody[]; hasMore: boolean } | Record<string, unknown>;
}> {
  const url = `${await app.getUrl()}/api/sessions${query}`;
  const response = await fetch(url, { headers: { 'x-user-id': externalId } });
  return { status: response.status, body: (await response.json()) as never };
}

/** Minutes apart so ordering is unambiguous regardless of clock precision. */
function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60_000);
}

describe('GET /api/sessions (Story 5.1)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('returns only the caller sessions, newest first', async () => {
    const userAExternal = randomUUID();
    const userBExternal = randomUUID();
    const userAId = await seedUser(pool, userAExternal);
    const userBId = await seedUser(pool, userBExternal);

    const oldest = await seedSessionRow(pool, userAId, {
      sourceUrl: 'https://a.example/1',
      createdAt: minutesAgo(3),
    });
    const middle = await seedSessionRow(pool, userAId, {
      sourceUrl: 'https://a.example/2',
      createdAt: minutesAgo(2),
    });
    const newest = await seedSessionRow(pool, userAId, {
      sourceUrl: 'https://a.example/3',
      createdAt: minutesAgo(1),
    });
    await seedSessionRow(pool, userBId, {
      sourceUrl: 'https://b.example/1',
      createdAt: minutesAgo(1),
    });

    const result = await getSessions(userAExternal, '');
    expect(result.status).toBe(200);
    const body = result.body as { sessions: SessionSummaryBody[]; hasMore: boolean };
    expect(body.sessions.map((s) => s.id)).toEqual([newest, middle, oldest]);
    expect(body.hasMore).toBe(false);
    // Deliberately minimal wire shape (AC #2/#9): id, sourceUrl, status, createdAt only.
    expect(body.sessions[0]).toMatchObject({
      id: newest,
      sourceUrl: 'https://a.example/3',
      status: 'ready',
    });
    expect(typeof body.sessions[0]!.createdAt).toBe('string');
  });

  it('paginates across 3+ pages using limit/before/hasMore, with no overlap or gaps', async () => {
    const userExternal = randomUUID();
    const userId = await seedUser(pool, userExternal);
    const ids: string[] = [];
    for (let i = 5; i >= 1; i -= 1) {
      // Oldest inserted first (i=5 -> 5 minutes ago ... i=1 -> 1 minute ago);
      // unshift accumulates ids[] newest-first.
      const id = await seedSessionRow(pool, userId, {
        sourceUrl: `https://pg.example/${i}`,
        createdAt: minutesAgo(i),
      });
      ids.unshift(id);
    }
    expect(ids).toHaveLength(5);

    const page1 = await getSessions(userExternal, '?limit=2');
    const body1 = page1.body as { sessions: SessionSummaryBody[]; hasMore: boolean };
    expect(body1.sessions.map((s) => s.id)).toEqual(ids.slice(0, 2));
    expect(body1.hasMore).toBe(true);

    const cursor1 = body1.sessions.at(-1)!.createdAt;
    const page2 = await getSessions(userExternal, `?limit=2&before=${encodeURIComponent(cursor1)}`);
    const body2 = page2.body as { sessions: SessionSummaryBody[]; hasMore: boolean };
    expect(body2.sessions.map((s) => s.id)).toEqual(ids.slice(2, 4));
    expect(body2.hasMore).toBe(true);

    const cursor2 = body2.sessions.at(-1)!.createdAt;
    const page3 = await getSessions(userExternal, `?limit=2&before=${encodeURIComponent(cursor2)}`);
    const body3 = page3.body as { sessions: SessionSummaryBody[]; hasMore: boolean };
    expect(body3.sessions.map((s) => s.id)).toEqual(ids.slice(4, 5));
    expect(body3.hasMore).toBe(false);

    // Combined, the 3 pages reconstruct the full newest-first list with no
    // duplicate and no skipped row.
    const combined = [...body1.sessions, ...body2.sessions, ...body3.sessions].map((s) => s.id);
    expect(combined).toEqual(ids);
  });

  it("user B's list never includes user A's sessions (user-scoping)", async () => {
    const userAExternal = randomUUID();
    const userBExternal = randomUUID();
    const userAId = await seedUser(pool, userAExternal);
    const userBId = await seedUser(pool, userBExternal);
    await seedSessionRow(pool, userAId, {
      sourceUrl: 'https://a.example/only',
      createdAt: minutesAgo(1),
    });
    // A B session exists too, so an empty B result isn't a trivial "no rows at all" pass.
    await seedSessionRow(pool, userBId, {
      sourceUrl: 'https://b.example/own',
      createdAt: minutesAgo(1),
    });

    const result = await getSessions(userBExternal, '');
    const body = result.body as { sessions: SessionSummaryBody[]; hasMore: boolean };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]!.sourceUrl).toBe('https://b.example/own');
  });

  it('rejects a limit above the max (50) at the Zod boundary with 400', async () => {
    const userExternal = randomUUID();
    await seedUser(pool, userExternal);
    const result = await getSessions(userExternal, '?limit=51');
    expect(result.status).toBe(400);
  });

  it('defaults to a page size of 20 when limit is omitted', async () => {
    const userExternal = randomUUID();
    const userId = await seedUser(pool, userExternal);
    for (let i = 0; i < 25; i += 1) {
      await seedSessionRow(pool, userId, {
        sourceUrl: `https://d.example/${i}`,
        createdAt: minutesAgo(i + 1),
      });
    }
    const result = await getSessions(userExternal, '');
    const body = result.body as { sessions: SessionSummaryBody[]; hasMore: boolean };
    expect(body.sessions).toHaveLength(20);
    expect(body.hasMore).toBe(true);
  });
});
