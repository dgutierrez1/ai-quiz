import { type QuizSessionRow, QuizSessionRowSchema } from '@ai-quiz/shared';
import { and, desc, eq, lt } from 'drizzle-orm';

import type {
  ListForUserParams,
  ListForUserResult,
  QuizRepositoryPort,
} from '../../../domain/ports/quiz-repository.port.js';
import { getRequestContext } from '../../../driving/middleware/request-context.js';
import { quizSessions } from './schema.js';

type QuizSessionCreateInput = Parameters<QuizRepositoryPort['createSession']>[0];
type QuizSessionUpdateInput = {
  readonly status: QuizSessionRow['status'];
  readonly errorMessage?: string | null;
  readonly actualCount?: number | null;
  readonly selectedCategories?: readonly string[];
  readonly finalScore?: number | null;
  readonly completedAt?: Date | null;
};

export class QuizSessionRepository implements QuizRepositoryPort {
  public async createSession(input: QuizSessionCreateInput): Promise<Readonly<QuizSessionRow>> {
    const rows = await getRequestContext()
      .tx.insert(quizSessions)
      .values({
        id: input.id,
        userId: input.userId,
        sourceUrl: input.sourceUrl,
        topic: input.topic ?? null,
        strategy: input.strategy,
        provider: input.provider,
        model: input.model,
        status: 'pending',
        questionCount: input.questionCount,
        selectedCategories: [],
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('quiz session insert returned no row');
    return Object.freeze(QuizSessionRowSchema.parse(row));
  }

  public async findByIdAndUserId(
    sessionId: string,
    userId: QuizSessionCreateInput['userId'],
  ): Promise<Readonly<QuizSessionRow> | null> {
    const rows = await getRequestContext()
      .tx.select()
      .from(quizSessions)
      .where(and(eq(quizSessions.id, sessionId), eq(quizSessions.userId, userId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return Object.freeze(QuizSessionRowSchema.parse(row));
  }

  /**
   * Updates a session row from inside the caller's request transaction. Used by
   * the generation pipeline to flip status to ready/failed and record the
   * shortfall `actualCount` + `selectedCategories`.
   */
  public async updateSession(
    sessionId: string,
    update: QuizSessionUpdateInput,
  ): Promise<Readonly<QuizSessionRow>> {
    const partial: Record<string, unknown> = { status: update.status };
    if (update.errorMessage !== undefined) partial.errorMessage = update.errorMessage;
    if (update.actualCount !== undefined) partial.actualCount = update.actualCount;
    if (update.selectedCategories !== undefined)
      partial.selectedCategories = [...update.selectedCategories];
    if (update.finalScore !== undefined) partial.finalScore = update.finalScore;
    if (update.completedAt !== undefined) partial.completedAt = update.completedAt;
    const rows = await getRequestContext()
      .tx.update(quizSessions)
      .set(partial)
      .where(eq(quizSessions.id, sessionId))
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`quiz session update returned no row for ${sessionId}`);
    return Object.freeze(QuizSessionRowSchema.parse(row));
  }

  /**
   * Story 5.1 Task 2 — `WHERE user_id = $1 [AND created_at < $2] ORDER BY
   * created_at DESC, id DESC LIMIT $3+1`. Fetches `limit + 1` rows; if more
   * than `limit` come back, the extra row is dropped and `hasMore = true`.
   * `id DESC` is a deterministic tie-break only (not a WHERE predicate) —
   * two sessions sharing the exact same microsecond `created_at` is
   * accepted as effectively impossible for this app's usage pattern, same
   * precision Story 4.1's chat pagination already accepts.
   */
  public async listForUser(
    userId: QuizSessionCreateInput['userId'],
    params: ListForUserParams,
  ): Promise<ListForUserResult> {
    const conditions = [eq(quizSessions.userId, userId)];
    if (params.before) conditions.push(lt(quizSessions.createdAt, params.before));

    const rows = await getRequestContext()
      .tx.select()
      .from(quizSessions)
      .where(and(...conditions))
      .orderBy(desc(quizSessions.createdAt), desc(quizSessions.id))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    return {
      rows: page.map((row) => Object.freeze(QuizSessionRowSchema.parse(row))),
      hasMore,
    };
  }
}
