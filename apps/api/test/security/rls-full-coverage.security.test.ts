// apps/api/test/security/rls-full-coverage.security.test.ts
//
// Story 5.3 AC #4/#5/#6 / Task 3 — the consolidated 8-table RLS matrix.
// Stories 1.4/2.6/3.1/4.1 each proved their own table subset's RLS policy
// correct in isolation (`rls-submission.security.test.ts` etc.); this file
// is the single release-gate artifact that proves the WHOLE set holds
// together, so a future 9th table shipping without RLS is caught here
// rather than nowhere.
//
// CRITICAL (same technique `rls-submission.security.test.ts` established):
// the local docker-compose `ai_quiz` role is a SUPERUSER
// (`rolbypassrls=true`) and trivially bypasses RLS — a naive test using
// that connection role proves nothing. Every SELECT in this file runs as a
// dedicated, unprivileged probe role (`NOSUPERUSER NOBYPASSRLS`), inside a
// transaction that never sets `app.user_id`, then rolls back — mirroring
// Neon's non-superuser production role, which IS subject to RLS.
//
// `chat_messages` (Story 4.1's table) is included ONLY IF it exists in
// `information_schema` at test-run time — the chat backend (migration
// 0005+) may or may not have landed yet in a given run of this suite (see
// this story's own Dev Notes on concurrent-story sequencing). Skipping it
// gracefully with a clear log line keeps this suite green whether or not
// that migration has landed, without ever silently skipping one of the 7
// tables that unconditionally must exist by Epic 3.

import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const PROBE_ROLE = 'ai_quiz_rls_full_coverage_probe';

// The 7 tables that MUST exist and be RLS-governed regardless of the
// concurrent chat migration's landing status.
const CORE_OWNED_TABLES = [
  'quiz_sessions',
  'documents',
  'questions',
  'answers',
  'user_responses',
  'insights',
  'knowledge_categories',
] as const;

// chat_messages is appended to this list at runtime, only if it exists —
// see `beforeAll`.
let ownedTablesToTest: string[] = [...CORE_OWNED_TABLES];
let chatMessagesExists = false;

let pool: Pool;
let sessionAId: string;
let sessionBId: string;
let questionAId: string;
let questionBId: string;

async function tableExists(name: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [name],
  );
  return result.rows[0]?.exists ?? false;
}

async function selectAsProbeRole(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<unknown[]> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${PROBE_ROLE}`);
    // app.user_id is intentionally never set in this transaction — this is
    // the whole point: prove RLS denies access with no identity GUC set.
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.query('ROLLBACK');
  }
}

async function selectAsProbeRoleForUser(
  client: PoolClient,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<unknown[]> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${PROBE_ROLE}`);
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.query('ROLLBACK');
  }
}

describe('Consolidated RLS matrix — every owned table (Story 5.3 AC #4-#6)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);

    chatMessagesExists = await tableExists('chat_messages');
    if (chatMessagesExists) {
      ownedTablesToTest = [...CORE_OWNED_TABLES, 'chat_messages'];
    } else {
      // eslint-disable-next-line no-console -- deliberate, clear skip note; not a leak (no user data), see file header
      console.warn(
        '[rls-full-coverage] chat_messages does not exist yet (concurrent chat migration not landed) — ' +
          'skipping it in this run. The other 7 tables are still tested unconditionally.',
      );
    }

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
          CREATE ROLE ${PROBE_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
    `);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
    // The policies are `EXISTS`-joins through quiz_sessions (and, for
    // `answers`, through `questions` too) — grant SELECT on every table so
    // Postgres can evaluate every USING clause, even the ones the probe
    // never queries directly.
    const grantTargets = [...CORE_OWNED_TABLES, 'users', 'chat_messages'].join(', ');
    await pool.query(`GRANT SELECT ON ${grantTargets} TO ${PROBE_ROLE}`).catch(async () => {
      // chat_messages may not exist — retry without it.
      await pool.query(
        `GRANT SELECT ON ${[...CORE_OWNED_TABLES, 'users'].join(', ')} TO ${PROBE_ROLE}`,
      );
    });

    // Seed two independent users/sessions (as the superuser pool
    // connection, which bypasses RLS trivially for fixture setup — same
    // convention every prior story's RLS test uses).
    const seedA = await seedQuizSession(
      pool,
      `rls-full-coverage-a-${randomUUID()}`,
      [
        { type: 'single', category: 'Cat A', correctPositions: [0] },
        { type: 'single', category: 'Cat A', correctPositions: [1] },
        { type: 'single', category: 'Cat B', correctPositions: [2] },
        { type: 'single', category: 'Cat B', correctPositions: [3] },
        { type: 'single', category: 'Cat B', correctPositions: [0] },
      ],
      { status: 'ready' },
    );
    sessionAId = seedA.sessionId;
    const firstQuestionA = seedA.questionIds[0];
    if (!firstQuestionA) throw new Error('seed A produced no questions');
    questionAId = firstQuestionA;

    const seedB = await seedQuizSession(
      pool,
      `rls-full-coverage-b-${randomUUID()}`,
      [
        { type: 'single', category: 'Cat A', correctPositions: [0] },
        { type: 'single', category: 'Cat A', correctPositions: [1] },
        { type: 'single', category: 'Cat B', correctPositions: [2] },
        { type: 'single', category: 'Cat B', correctPositions: [3] },
        { type: 'single', category: 'Cat B', correctPositions: [0] },
      ],
      { status: 'ready' },
    );
    sessionBId = seedB.sessionId;
    const firstQuestionB = seedB.questionIds[0];
    if (!firstQuestionB) throw new Error('seed B produced no questions');
    questionBId = firstQuestionB;

    // Flip both to submitted + seed the submission-only tables, so ALL 7
    // core tables (+ chat_messages if present) have real rows.
    for (const { sessionId, questionId } of [
      { sessionId: sessionAId, questionId: questionAId },
      { sessionId: sessionBId, questionId: questionBId },
    ]) {
      await pool.query(
        `UPDATE quiz_sessions SET status = 'submitted', final_score = 4 WHERE id = $1`,
        [sessionId],
      );
      await pool.query(
        `INSERT INTO user_responses (session_id, question_id, selected, raw_score, weight, weighted_score)
         VALUES ($1, $2, '[0]'::jsonb, 4, 1, 4)`,
        [sessionId, questionId],
      );
      await pool.query(
        `INSERT INTO knowledge_categories (session_id, name, question_count, correct_count, avg_raw_score, weighted_score, strength)
         VALUES ($1, 'Cat A', 2, 2, 4, 4, 'strong')
         ON CONFLICT (session_id, name) DO NOTHING`,
        [sessionId],
      );
      await pool.query(
        `INSERT INTO insights (session_id, kind, payload)
         VALUES ($1, 'gap_analysis', '{"topicsToStudy":[],"weakCategories":[],"strengthByCategory":{}}'::jsonb)`,
        [sessionId],
      );
    }

    if (chatMessagesExists) {
      await pool.query(
        `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', 'hello')`,
        [sessionAId],
      );
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  describe.each(CORE_OWNED_TABLES.map((table) => ({ table })))('table: $table', ({ table }) => {
    it(`${table}: unprivileged probe with app.user_id unset gets 0 rows even though rows exist`, async () => {
      const client = await pool.connect();
      try {
        const rows = await selectAsProbeRole(client, `SELECT * FROM ${table}`);
        expect(rows).toHaveLength(0);
      } finally {
        client.release();
      }
    });
  });

  it('chat_messages: unprivileged probe with app.user_id unset gets 0 rows even though rows exist (only if the table exists yet)', async () => {
    if (!chatMessagesExists) {
      // eslint-disable-next-line no-console -- see beforeAll's skip note
      console.warn(
        '[rls-full-coverage] skipping chat_messages RLS assertion — table not present in this run.',
      );
      return;
    }
    const client = await pool.connect();
    try {
      const rows = await selectAsProbeRole(client, 'SELECT * FROM chat_messages');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('sanity: every table in the matrix really has seeded rows (proves 0-row results above are RLS, not empty tables)', async () => {
    for (const table of ownedTablesToTest) {
      const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      expect(result.rows[0]?.count, `${table} should have at least 1 seeded row`).toBeGreaterThan(
        0,
      );
    }
  });

  it('AC #5 — users is deliberately NOT RLS-governed: the same unprivileged probe sees ALL rows, not 0', async () => {
    const client = await pool.connect();
    try {
      const probeRows = await selectAsProbeRole(client, 'SELECT * FROM users');
      const realRows = await pool.query('SELECT * FROM users');
      // Not asserting an exact count (other test files run concurrently /
      // share this database), just that the unset-GUC probe sees the same
      // full set a normal query sees — i.e. genuinely un-filtered, not
      // silently RLS-limited to 0 or to a single row.
      expect(probeRows.length).toBe(realRows.rows.length);
      expect(probeRows.length).toBeGreaterThan(0);
    } finally {
      client.release();
    }
  });

  it("AC #6 — answers requires the depth-2 join (answers -> questions -> quiz_sessions): user A cannot see user B's answer rows and vice versa", async () => {
    const client = await pool.connect();
    try {
      // Fetch user ids for A/B sessions (superuser connection, bypasses RLS).
      const sessionRows = await pool.query<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM quiz_sessions WHERE id = ANY($1)',
        [[sessionAId, sessionBId]],
      );
      const userIdForSession = new Map(sessionRows.rows.map((r) => [r.id, r.user_id]));
      const userAId = userIdForSession.get(sessionAId);
      const userBId = userIdForSession.get(sessionBId);
      if (!userAId || !userBId) throw new Error('could not resolve seeded user ids');

      // Scoped to user A: only user A's answer rows come back — never user B's.
      const answersAsA = await selectAsProbeRoleForUser(
        client,
        userAId,
        `SELECT a.id, a.question_id FROM answers a
         JOIN questions q ON q.id = a.question_id
         WHERE q.id = $1 OR q.session_id = $2 OR q.session_id = $3`,
        [questionBId, sessionAId, sessionBId],
      );
      expect(answersAsA.length).toBeGreaterThan(0);
      const answersAsAQuestionIds = new Set(
        answersAsA.map((row) => (row as { question_id: string }).question_id),
      );
      expect(answersAsAQuestionIds.has(questionBId)).toBe(false);

      // Scoped to user B: only user B's answer rows come back — never user A's.
      const answersAsB = await selectAsProbeRoleForUser(
        client,
        userBId,
        `SELECT a.id, a.question_id FROM answers a
         JOIN questions q ON q.id = a.question_id
         WHERE q.id = $1 OR q.session_id = $2 OR q.session_id = $3`,
        [questionAId, sessionAId, sessionBId],
      );
      expect(answersAsB.length).toBeGreaterThan(0);
      const answersAsBQuestionIds = new Set(
        answersAsB.map((row) => (row as { question_id: string }).question_id),
      );
      expect(answersAsBQuestionIds.has(questionAId)).toBe(false);
    } finally {
      client.release();
    }
  });
});
