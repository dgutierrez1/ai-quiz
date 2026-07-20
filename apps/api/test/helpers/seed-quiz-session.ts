// apps/api/test/helpers/seed-quiz-session.ts
//
// Story 3.1 test fixture helper. Generation (Story 2.6) isn't wired end to
// end through the HTTP API yet, so integration/security tests for the
// submit flow seed a `ready` session (questions/answers/document) directly
// via Drizzle, using the pool's superuser role — which bypasses RLS, same
// as any other test-fixture setup path — rather than driving the full
// ingest→LLM→persist pipeline.

import type { Pool } from 'pg';

import { createDatabase } from '../../src/adapters/persistence/drizzle/client.js';
import {
  answers,
  documents,
  questions,
  quizSessions,
  users,
} from '../../src/adapters/persistence/drizzle/schema.js';

export interface SeedQuestionSpec {
  readonly type: 'single' | 'multiple';
  readonly category: string;
  readonly correctPositions: readonly number[];
}

export interface SeedResult {
  readonly sessionId: string;
  readonly userId: string;
  readonly questionIds: readonly string[];
}

export interface SeedOptions {
  readonly status?: 'pending' | 'ready' | 'submitted' | 'failed';
  readonly sourceUrl?: string;
  readonly chunks?: readonly string[];
}

/**
 * Seeds a user + quiz session (+ questions/answers + an optional document)
 * directly via Drizzle, bypassing RLS via the superuser connection role.
 * `questionsSpec.length` must be in [5, 8] to satisfy `QuizSessionRowSchema`.
 */
export async function seedQuizSession(
  pool: Pool,
  externalUserId: string,
  questionsSpec: readonly SeedQuestionSpec[],
  options: SeedOptions = {},
): Promise<SeedResult> {
  if (questionsSpec.length < 5 || questionsSpec.length > 8) {
    throw new Error(
      `seedQuizSession: questionsSpec.length must be 5-8, got ${questionsSpec.length}`,
    );
  }

  const db = createDatabase(pool);

  const [user] = await db
    .insert(users)
    .values({ externalId: externalUserId })
    .onConflictDoUpdate({ target: users.externalId, set: { externalId: externalUserId } })
    .returning();
  if (!user) throw new Error('seedQuizSession: user insert failed');

  const [session] = await db
    .insert(quizSessions)
    .values({
      userId: user.id,
      sourceUrl: options.sourceUrl ?? 'https://example.com/doc.md',
      strategy: 'mixed',
      provider: 'minimax',
      model: 'MiniMax-M3',
      status: options.status ?? 'ready',
      questionCount: questionsSpec.length,
      selectedCategories: [...new Set(questionsSpec.map((q) => q.category))],
    })
    .returning();
  if (!session) throw new Error('seedQuizSession: session insert failed');

  if (options.chunks && options.chunks.length > 0) {
    await db.insert(documents).values({
      sessionId: session.id,
      sourceUrl: options.sourceUrl ?? 'https://example.com/doc.md',
      contentMarkdown: options.chunks.join('\n\n'),
      chunks: [...options.chunks],
      contentHash: 'test-hash',
      byteSize: options.chunks.join('').length,
      tokenEstimate: Math.ceil(options.chunks.join('').length / 4),
    });
  }

  const questionIds: string[] = [];
  for (let index = 0; index < questionsSpec.length; index += 1) {
    const spec = questionsSpec[index]!;
    const [question] = await db
      .insert(questions)
      .values({
        sessionId: session.id,
        position: index,
        text: `Question ${index} about ${spec.category}`,
        type: spec.type,
        category: spec.category,
        explanation: '',
      })
      .returning();
    if (!question) throw new Error('seedQuizSession: question insert failed');
    questionIds.push(question.id);

    for (let position = 0; position < 4; position += 1) {
      await db.insert(answers).values({
        questionId: question.id,
        position,
        text: `Answer ${position}`,
        isCorrect: spec.correctPositions.includes(position),
      });
    }
  }

  return { sessionId: session.id, userId: user.id, questionIds };
}
