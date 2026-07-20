import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { seedQuizSession } from '../helpers/seed-quiz-session.js';

// Story 3.1 AC #11 — `user_responses`, `insights`, `knowledge_categories`
// must each have ENABLE + FORCE ROW LEVEL SECURITY. The docker-compose
// Postgres role (`ai_quiz`) is a superuser and therefore bypasses RLS
// entirely (rolbypassrls=true) — this proves nothing about FORCE. To
// actually exercise the policy, this test switches to a fresh, unprivileged
// probe role (NOSUPERUSER NOBYPASSRLS) for the SELECT itself, mirroring how
// Neon's non-superuser production role is subject to RLS.
const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const PROBE_ROLE = 'ai_quiz_rls_probe';

let pool: Pool;

async function selectAsProbeRole(client: PoolClient, table: string): Promise<unknown[]> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${PROBE_ROLE}`);
    // app.user_id is intentionally never set in this transaction.
    const result = await client.query(`SELECT * FROM ${table}`);
    return result.rows;
  } finally {
    await client.query('ROLLBACK');
  }
}

describe('RLS on submission tables (Story 3.1)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
          CREATE ROLE ${PROBE_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
    `);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
    // The RLS policies are `EXISTS`-joins through `quiz_sessions` — Postgres
    // needs SELECT on that table too to even evaluate the USING clause, even
    // though the probe's own queries never select from it directly.
    await pool.query(
      `GRANT SELECT ON user_responses, insights, knowledge_categories, quiz_sessions TO ${PROBE_ROLE}`,
    );

    // Seed real rows (as the superuser role, which bypasses RLS trivially)
    // so a 0-row probe result is meaningful rather than a trivially-empty
    // table.
    const seed = await seedQuizSession(
      pool,
      `rls-probe-${randomUUID()}`,
      [
        { type: 'single', category: 'Cat A', correctPositions: [0] },
        { type: 'single', category: 'Cat A', correctPositions: [1] },
        { type: 'single', category: 'Cat B', correctPositions: [2] },
        { type: 'single', category: 'Cat B', correctPositions: [3] },
        { type: 'single', category: 'Cat B', correctPositions: [0] },
      ],
      { status: 'ready' },
    );
    const [firstQuestionId] = seed.questionIds;
    if (!firstQuestionId) throw new Error('seed produced no questions');

    await pool.query(
      `UPDATE quiz_sessions SET status = 'submitted', final_score = 4 WHERE id = $1`,
      [seed.sessionId],
    );
    await pool.query(
      `INSERT INTO user_responses (session_id, question_id, selected, raw_score, weight, weighted_score)
       VALUES ($1, $2, '[0]'::jsonb, 4, 1, 4)`,
      [seed.sessionId, firstQuestionId],
    );
    await pool.query(
      `INSERT INTO knowledge_categories (session_id, name, question_count, correct_count, avg_raw_score, weighted_score, strength)
       VALUES ($1, 'Cat A', 2, 2, 4, 4, 'strong')
       ON CONFLICT (session_id, name) DO NOTHING`,
      [seed.sessionId],
    );
    await pool.query(
      `INSERT INTO insights (session_id, kind, payload)
       VALUES ($1, 'gap_analysis', '{"topicsToStudy":[],"weakCategories":[],"strengthByCategory":{}}'::jsonb)`,
      [seed.sessionId],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('user_responses: returns 0 rows for the probe role with app.user_id unset', async () => {
    const client = await pool.connect();
    try {
      const rows = await selectAsProbeRole(client, 'user_responses');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('insights: returns 0 rows for the probe role with app.user_id unset', async () => {
    const client = await pool.connect();
    try {
      const rows = await selectAsProbeRole(client, 'insights');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('knowledge_categories: returns 0 rows for the probe role with app.user_id unset', async () => {
    const client = await pool.connect();
    try {
      const rows = await selectAsProbeRole(client, 'knowledge_categories');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('sanity: the seeded rows really exist (proves the 0-row result is RLS, not empty tables)', async () => {
    const responses = await pool.query('SELECT * FROM user_responses');
    expect(responses.rows.length).toBeGreaterThan(0);
  });
});
