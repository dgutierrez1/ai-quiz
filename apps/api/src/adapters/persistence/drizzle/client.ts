import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolConfig } from 'pg';
import pg from 'pg';

import { schema } from './schema.js';

const { Pool: PgPool, types } = pg;
const POSTGRES_NUMERIC_OID = 1700;
const MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = [250, 500, 1_000, 2_000, 4_000] as const;

types.setTypeParser(POSTGRES_NUMERIC_OID, (value) => {
  const parsed = Number(value);
  // node-postgres returns numeric as a string by default; converting with
  // Number() can yield NaN / Infinity for corrupted or extreme values. We
  // coerce those to null so the Zod row schema (`.number()`) can reject
  // them with a clear "expected number, got null" message at the boundary
  // instead of silently contaminating downstream scoring math.
  return Number.isFinite(parsed) ? parsed : null;
});

export const DATABASE_TOKEN = Symbol('DATABASE_TOKEN');

export type DrizzleDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseState {
  readonly db: DrizzleDatabase;
  readonly pool: Pool;
  readonly degraded: boolean;
}

export interface DatabaseInitializationOptions {
  readonly databaseUrl: string;
  readonly createPool?: (databaseUrl: string) => Pool;
  readonly createDatabase?: (pool: Pool) => DrizzleDatabase;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly backoffMs?: readonly number[];
  readonly log?: (message: string, error: unknown) => void;
}

export function createPool(databaseUrl: string): Pool {
  const databaseUrlObject = new URL(databaseUrl);
  const isLocalhost =
    databaseUrlObject.hostname === 'localhost' || databaseUrlObject.hostname === '127.0.0.1';
  const config: PoolConfig = {
    connectionString: databaseUrl,
    statement_timeout: 10_000,
    query_timeout: 15_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 30_000,
  };

  if (!isLocalhost) {
    config.ssl = { rejectUnauthorized: true };
  }

  const pool = new PgPool(config);
  // Register the error handler IMMEDIATELY after construction so that an
  // idle-client error (Neon auto-suspend drops, NAT timeout, etc.) cannot
  // become an unhandled EventEmitter error and crash the process. AD-20 +
  // AC #8 demand /healthz stays 200 even while the DB is degraded.
  pool.on('error', (error: Error) => {
    // Replace with pino in Story 1.6; console.error is acceptable here
    // because pino is explicitly out of scope for this story.
    console.error('[pg pool] idle client error:', error.message);
  });
  return pool;
}

export function createDatabase(pool: Pool): DrizzleDatabase {
  return drizzle(pool, { schema });
}

export async function initializeDatabase({
  databaseUrl,
  createPool: makePool = createPool,
  createDatabase: makeDatabase = createDatabase,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  backoffMs = DEFAULT_BACKOFF_MS,
  log = (message, error) => {
    console.error(message, error);
  },
}: DatabaseInitializationOptions): Promise<DatabaseState> {
  const pool = makePool(databaseUrl);
  const db = makeDatabase(pool);
  let lastError: unknown;
  const attempts = MAX_ATTEMPTS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return { db, pool, degraded: false };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        const delay = backoffMs[attempt] ?? DEFAULT_BACKOFF_MS[attempt];
        if (delay !== undefined) {
          await sleep(delay);
        }
      }
    }
  }

  log('Database initialization degraded after retry exhaustion', lastError);
  return { db, pool, degraded: true };
}

export { POSTGRES_NUMERIC_OID };
