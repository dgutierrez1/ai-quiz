import type { Pool } from 'pg';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPool,
  type DrizzleDatabase,
  initializeDatabase,
  POSTGRES_NUMERIC_OID,
} from '../src/adapters/persistence/drizzle/client.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const REMOTE_DATABASE_URL = 'postgres://user:password@db.example.com/ai_quiz?sslmode=require';

const pools: Pool[] = [];

afterEach(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  pools.length = 0;
});

describe('database client', () => {
  it('configures the required timeout and remote SSL options', () => {
    const localPool = createPool(LOCAL_DATABASE_URL);
    const remotePool = createPool(REMOTE_DATABASE_URL);
    pools.push(localPool, remotePool);

    expect(localPool.options).toMatchObject({
      statement_timeout: 10_000,
      query_timeout: 15_000,
    });
    expect(localPool.options.ssl).toBeUndefined();
    expect(remotePool.options).toMatchObject({
      statement_timeout: 10_000,
      query_timeout: 15_000,
      ssl: { rejectUnauthorized: true },
    });
  });

  it('parses PostgreSQL numeric values as numbers', () => {
    const parser = pg.types.getTypeParser(POSTGRES_NUMERIC_OID, 'text');

    expect(parser('12.5')).toBe(12.5);
  });

  it('retries five times with exponential backoff and returns degraded state', async () => {
    const query = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const pool = { query } as unknown as Pool;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const database = {} as DrizzleDatabase;

    const state = await initializeDatabase({
      databaseUrl: LOCAL_DATABASE_URL,
      createPool: () => pool,
      createDatabase: () => database,
      sleep,
      backoffMs: [250, 500, 1_000, 2_000, 4_000],
      log,
    });

    expect(query).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([250, 500, 1_000, 2_000]);
    expect(state).toEqual({ db: database, pool, degraded: true });
    expect(log).toHaveBeenCalledOnce();
  });

  it('returns normally after a transient connection failure', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('cold database'))
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const pool = { query } as unknown as Pool;
    const database = {} as DrizzleDatabase;

    const state = await initializeDatabase({
      databaseUrl: LOCAL_DATABASE_URL,
      createPool: () => pool,
      createDatabase: () => database,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(state).toEqual({ db: database, pool, degraded: false });
  });
});
