import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';

// Story 3.1 AC #13 regression: OID 1700 (numeric) columns must round-trip as
// JS `number`, not string — this is what makes `final_score`/`raw_score`/
// `weight`/`weighted_score`/`avg_raw_score` legal against plain `z.number()`
// row schemas (never `z.coerce.number()`).
const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';

let pool: Pool;

describe('pg numeric type parser (real query)', () => {
  beforeAll(() => {
    pool = createPool(LOCAL_DATABASE_URL);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns a numeric column value as typeof number from a real query', async () => {
    const result = await pool.query<{ value: number }>('SELECT 12.50::numeric AS value');
    expect(typeof result.rows[0]?.value).toBe('number');
    expect(result.rows[0]?.value).toBe(12.5);
  });

  it('round-trips a real numeric column on user_responses', async () => {
    const result = await pool.query<{ raw_score: number }>(
      'SELECT raw_score FROM user_responses WHERE false UNION ALL SELECT 3.50::numeric',
    );
    expect(typeof result.rows[0]?.raw_score).toBe('number');
  });
});
