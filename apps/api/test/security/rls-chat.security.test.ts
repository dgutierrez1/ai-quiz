import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { seedQuizSession } from '../helpers/seed-quiz-session.js';

// Story 4.1 AC #1/#10 — extends the RLS test pattern Story 1.4/3.1
// established: direct SELECT as an unprivileged, non-superuser probe role
// with `app.user_id` unset must return 0 rows, even though real rows exist.
const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const PROBE_ROLE = 'ai_quiz_rls_probe';

let pool: Pool;

async function selectAsProbeRole(client: PoolClient): Promise<unknown[]> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${PROBE_ROLE}`);
    const result = await client.query('SELECT * FROM chat_messages');
    return result.rows;
  } finally {
    await client.query('ROLLBACK');
  }
}

describe('RLS on chat_messages (Story 4.1 AC #1/#10)', () => {
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
    await pool.query(`GRANT SELECT ON chat_messages, quiz_sessions TO ${PROBE_ROLE}`);

    const seed = await seedQuizSession(
      pool,
      `rls-chat-probe-${randomUUID()}`,
      [
        { type: 'single', category: 'Cat A', correctPositions: [0] },
        { type: 'single', category: 'Cat A', correctPositions: [1] },
        { type: 'single', category: 'Cat B', correctPositions: [2] },
        { type: 'single', category: 'Cat B', correctPositions: [3] },
        { type: 'single', category: 'Cat B', correctPositions: [0] },
      ],
      { status: 'ready' },
    );
    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', 'hello')`,
      [seed.sessionId],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns 0 rows for the probe role with app.user_id unset', async () => {
    const client = await pool.connect();
    try {
      const rows = await selectAsProbeRole(client);
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('sanity: the seeded row really exists (proves the 0-row result is RLS, not an empty table)', async () => {
    const rows = await pool.query('SELECT * FROM chat_messages');
    expect(rows.rows.length).toBeGreaterThan(0);
  });
});
