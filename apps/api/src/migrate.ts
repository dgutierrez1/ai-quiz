import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase, createPool } from './adapters/persistence/drizzle/client.js';
import { validateEnv } from './config/env.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

export async function runMigrations(databaseUrl = validateEnv().DATABASE_URL): Promise<void> {
  const pool = createPool(databaseUrl);

  try {
    await migrate(createDatabase(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const entryPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entryPath === fileURLToPath(import.meta.url)) {
  void runMigrations().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`Migration failed: ${String(error)}\n`);
      process.exit(1);
    },
  );
}
