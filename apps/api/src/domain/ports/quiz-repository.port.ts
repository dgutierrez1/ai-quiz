import type { CreateSessionRequest, QuizSessionRow } from '@ai-quiz/shared';

import type { InternalUserId } from './user-repository.port.js';

export interface QuizSessionUpdateInput {
  readonly status: 'pending' | 'ready' | 'submitted' | 'failed';
  readonly errorMessage?: string | null;
  readonly actualCount?: number | null;
  readonly selectedCategories?: readonly string[];
  readonly finalScore?: number | null;
  readonly completedAt?: Date | null;
}

export interface ListForUserParams {
  readonly limit: number;
  readonly before?: Date;
}

export interface ListForUserResult {
  readonly rows: readonly QuizSessionRow[];
  readonly hasMore: boolean;
}

export interface QuizRepositoryPort {
  createSession(
    input: Readonly<CreateSessionRequest> & { id: string; userId: InternalUserId },
  ): Promise<Readonly<QuizSessionRow>>;
  findByIdAndUserId(
    sessionId: string,
    userId: InternalUserId,
  ): Promise<Readonly<QuizSessionRow> | null>;
  updateSession(
    sessionId: string,
    update: QuizSessionUpdateInput,
  ): Promise<Readonly<QuizSessionRow>>;
  /**
   * Story 5.1 — `GET /api/sessions`. Scoped entirely by `WHERE user_id = ?`
   * (this is the root owned table, no `session_id` join — same shape as
   * `findByIdAndUserId` above, not the child-table pattern the
   * `@ai-quiz/no-unscoped-session-query` lint rule targets). Newest first,
   * riding `idx_quiz_sessions_user_id_created_at` (Story 1.3). `before` is
   * an exclusive `created_at` cursor; fetches `limit + 1` rows to derive
   * `hasMore` without a second query.
   */
  listForUser(userId: InternalUserId, params: ListForUserParams): Promise<ListForUserResult>;
}
