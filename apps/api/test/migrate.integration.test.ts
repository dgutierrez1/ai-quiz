import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, createPool } from '../src/adapters/persistence/drizzle/client.js';

// Use a dedicated test database so this suite cannot accidentally wipe the
// developer's local `ai_quiz` DB. The DATABASE_URL test env (or .env) must
// expose the same credentials with a different db name; the docker-compose
// `postgres:16.14-alpine` service supports both.
const LOCAL_TEST_DATABASE_URL =
  process.env.MIGRATE_TEST_DATABASE_URL ??
  'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz_migrate_test';

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pool: Pool;

async function applicationTables(): Promise<string[]> {
  const db = createDatabase(pool);
  const result = await db.execute<{ table_name: string }>(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return result.rows.map((row) => row.table_name);
}

async function journalCount(): Promise<number> {
  const db = createDatabase(pool);
  // The journal table only exists once at least one migration has been
  // applied. Pre-migration state: count = 0. Catch the "does not exist"
  // error rather than wrapping the query (the planner rejects the FROM
  // reference even with a guard WHERE filter).
  try {
    const journalResult = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM drizzle.__drizzle_migrations
    `);
    return Number(journalResult.rows[0]?.count ?? '0');
  } catch (error) {
    const pgCode = (error as { cause?: { code?: string } }).cause?.code;
    if (pgCode === '42P01') return 0; // undefined_table — no migrations yet
    throw error;
  }
}

function runMigrationCli(): void {
  execFileSync(process.execPath, [resolve(API_ROOT, 'dist/main.js'), 'migrate'], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: LOCAL_TEST_DATABASE_URL,
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });
}

describe('migration runner', () => {
  beforeAll(async () => {
    // Refuse to run unless the URL targets a *_test database so a developer
    // cannot lose their working dataset by running `pnpm verify` against the
    // default `ai_quiz` DB.
    if (!LOCAL_TEST_DATABASE_URL.includes('_test')) {
      throw new Error(
        `Refusing to run migration test against non-test database: ${LOCAL_TEST_DATABASE_URL}. ` +
          'Set MIGRATE_TEST_DATABASE_URL or use a URL whose path contains `_test`.',
      );
    }

    // Connect to the default `postgres` database to create our test DB if it
    // doesn't exist (CREATE DATABASE cannot run inside the target DB).
    const adminUrl = LOCAL_TEST_DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
    const adminPool = createPool(adminUrl);
    const adminDb = createDatabase(adminPool);
    try {
      await adminDb.execute(sql`CREATE DATABASE ai_quiz_migrate_test`);
    } catch (error) {
      // `CREATE DATABASE` fails with Postgres code 42P04 if the database
      // already exists; anything else (auth, network) must propagate.
      // Drizzle wraps the underlying pg error on `.cause`, not `.code` —
      // check by nested cause code rather than message.
      const pgCode = (error as { cause?: { code?: string } }).cause?.code;
      if (pgCode !== '42P04') throw error;
    }
    await adminPool.end();

    pool = createPool(LOCAL_TEST_DATABASE_URL);
    const db = createDatabase(pool);
    await db.execute(sql.raw('DROP SCHEMA public CASCADE'));
    await db.execute(sql.raw('DROP SCHEMA IF EXISTS drizzle CASCADE'));
    await db.execute(sql.raw('CREATE SCHEMA public'));
    await pool.end();
    pool = createPool(LOCAL_TEST_DATABASE_URL);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('applies the full ordered migration set (Story 1.3 + 1.4 RLS + 2.x)', async () => {
    const before = await journalCount();
    runMigrationCli();

    const tables = await applicationTables();
    expect(tables).toContain('users');
    expect(tables).toContain('quiz_sessions');
    expect(tables).toContain('documents');
    expect(tables).toContain('questions');
    expect(tables).toContain('answers');
    expect(tables).toContain('knowledge_categories');

    const db = createDatabase(pool);
    const indexResult = await db.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'quiz_sessions'
    `);
    expect(indexResult.rows.map((row) => row.indexname)).toContain(
      'idx_quiz_sessions_user_id_created_at',
    );

    // Every migration in the committed journal is applied exactly once. The
    // expected count is read from the journal rather than hardcoded, so adding
    // a migration in a later story does not falsely fail this assertion.
    const journal = JSON.parse(
      readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: readonly unknown[] };
    expect(await journalCount()).toBe(before + journal.entries.length);
  });

  it('is idempotent on a second run (journal + table state unchanged)', async () => {
    const beforeJournal = await journalCount();
    const beforeTables = await applicationTables();

    runMigrationCli();

    const afterJournal = await journalCount();
    const afterTables = await applicationTables();

    // Idempotency invariant: a re-run MUST NOT re-apply any migration or
    // create/destroy any table. Drizzle Kit's migrator enforces this; the
    // assertion locks the behavior so a future bug in the migrator or in
    // the schema catches it.
    expect(afterJournal).toBe(beforeJournal);
    expect(afterTables).toEqual(beforeTables);
  });
});
