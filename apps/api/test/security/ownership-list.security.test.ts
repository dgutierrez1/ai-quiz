// apps/api/test/security/ownership-list.security.test.ts
//
// Story 5.1 AC #7 / Task 10 — the list-scoping regression, distinct from
// Story 1.4's existing `GET /sessions/:id` 404 test (single-item case,
// already covered). `GET /api/sessions` has no `:id` and therefore no
// `@OwnsSession()` interceptor to guard it (AC #7 explicitly documents
// this) — scoping is entirely the repository's `WHERE user_id = ?` filter
// (AD-9), with Postgres RLS as the database-layer backstop. This test
// proves another user's sessions never leak through the list route, in
// any page.

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
}

async function getSessions(
  externalId: string,
  query = '',
): Promise<{ status: number; body: { sessions: SessionSummaryBody[]; hasMore: boolean } }> {
  const url = `${await app.getUrl()}/api/sessions${query}`;
  const response = await fetch(url, { headers: { 'x-user-id': externalId } });
  return {
    status: response.status,
    body: (await response.json()) as { sessions: SessionSummaryBody[]; hasMore: boolean },
  };
}

describe('ownership isolation on GET /api/sessions (Story 5.1)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("another user's sessions never appear in the caller's list", async () => {
    const userAExternal = randomUUID();
    const userBExternal = randomUUID();
    const userAId = await seedUser(pool, userAExternal);
    const userBId = await seedUser(pool, userBExternal);

    const secretId = await seedSessionRow(pool, userAId, {
      sourceUrl: 'https://secret.example/a-only',
      createdAt: new Date(),
    });
    await seedSessionRow(pool, userBId, {
      sourceUrl: 'https://open.example/b-only',
      createdAt: new Date(),
    });

    const asB = await getSessions(userBExternal);
    expect(asB.status).toBe(200);
    expect(asB.body.sessions.map((s) => s.id)).not.toContain(secretId);
    expect(asB.body.sessions.every((s) => s.sourceUrl !== 'https://secret.example/a-only')).toBe(
      true,
    );
  });

  it('leakage never appears on a later page either (pagination does not bypass scoping)', async () => {
    const userAExternal = randomUUID();
    const userBExternal = randomUUID();
    const userAId = await seedUser(pool, userAExternal);
    const userBId = await seedUser(pool, userBExternal);

    // A has more rows than B's page size, so if scoping were broken, A's
    // rows would spill into B's second page.
    for (let i = 0; i < 3; i += 1) {
      await seedSessionRow(pool, userAId, {
        sourceUrl: `https://secret.example/a-${i}`,
        createdAt: new Date(Date.now() - i * 60_000),
      });
    }
    await seedSessionRow(pool, userBId, {
      sourceUrl: 'https://open.example/b-0',
      createdAt: new Date(),
    });

    const page1 = await getSessions(userBExternal, '?limit=1');
    expect(page1.body.sessions).toHaveLength(1);
    expect(page1.body.hasMore).toBe(false);
    expect(
      page1.body.sessions.every((s) => !s.sourceUrl.startsWith('https://secret.example')),
    ).toBe(true);
  });

  it("a user with zero sessions gets an empty list, not another user's data", async () => {
    const emptyUserExternal = randomUUID();
    const otherUserExternal = randomUUID();
    await seedUser(pool, emptyUserExternal);
    const otherUserId = await seedUser(pool, otherUserExternal);
    await seedSessionRow(pool, otherUserId, {
      sourceUrl: 'https://open.example/other',
      createdAt: new Date(),
    });

    const result = await getSessions(emptyUserExternal);
    expect(result.status).toBe(200);
    expect(result.body.sessions).toEqual([]);
    expect(result.body.hasMore).toBe(false);
  });
});
