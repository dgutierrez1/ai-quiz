// apps/api/test/helpers/seed-session-row.ts
//
// Story 5.1 — a lighter seeding helper for `GET /api/sessions` (list) tests,
// which need direct control over `created_at` (for deterministic
// ordering/pagination assertions) and don't need any questions/answers
// (unlike `seed-quiz-session.ts`, which Story 3.1's submit-flow tests
// use). Inserts directly via Drizzle using the pool's superuser role,
// bypassing RLS — same fixture-setup convention as `seed-quiz-session.ts`.

import type { Pool } from 'pg';

import { createDatabase } from '../../src/adapters/persistence/drizzle/client.js';
import { quizSessions, users } from '../../src/adapters/persistence/drizzle/schema.js';

export async function seedUser(pool: Pool, externalId: string): Promise<string> {
  const db = createDatabase(pool);
  const [user] = await db
    .insert(users)
    .values({ externalId })
    .onConflictDoUpdate({ target: users.externalId, set: { externalId } })
    .returning();
  if (!user) throw new Error('seedUser: insert failed');
  return user.id;
}

export interface SeedSessionRowOptions {
  readonly sourceUrl?: string;
  readonly status?: 'pending' | 'ready' | 'submitted' | 'failed';
  readonly createdAt: Date;
}

/** Seeds a single bare `quiz_sessions` row (no questions/answers/document). */
export async function seedSessionRow(
  pool: Pool,
  userId: string,
  options: SeedSessionRowOptions,
): Promise<string> {
  const db = createDatabase(pool);
  const [session] = await db
    .insert(quizSessions)
    .values({
      userId,
      sourceUrl: options.sourceUrl ?? 'https://example.com/doc.md',
      strategy: 'mixed',
      provider: 'minimax',
      model: 'MiniMax-M3',
      status: options.status ?? 'ready',
      questionCount: 5,
      selectedCategories: [],
      createdAt: options.createdAt,
    })
    .returning();
  if (!session) throw new Error('seedSessionRow: insert failed');
  return session.id;
}
