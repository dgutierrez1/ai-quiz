import type {
  GeneratedQuestionDto,
  QuizSessionProvider,
  QuizSessionStrategy,
  SessionQuestionRowDto,
} from '@ai-quiz/shared';

export interface PersistGeneratedQuizInput {
  /**
   * Generated client-side (not by a prior DB insert — see the doc comment
   * on `persistGeneratedQuiz` below for why there is deliberately no
   * separate 'pending' row this appends to).
   */
  readonly sessionId: string;
  readonly userId: string;
  readonly sourceUrl: string;
  readonly topic?: string | null;
  readonly strategy: QuizSessionStrategy;
  readonly provider: QuizSessionProvider;
  readonly model: string;
  readonly questionCount: number;
  readonly contentMarkdown: string;
  readonly chunks: readonly string[];
  readonly tokenEstimate: number;
  readonly byteSize: number;
  /** Array order IS the final position order — index i persists as position i. */
  readonly questions: readonly GeneratedQuestionDto[];
  readonly selectedCategories: readonly string[];
  /** Only set (non-null) when < the originally-requested questionCount. */
  readonly actualCount: number | null;
}

export interface FailedSessionParams {
  /**
   * The raw `X-User-Id` header value (NOT the internal uuid). The failure
   * write re-upserts `users` by external id inside its own fresh
   * transaction before inserting `quiz_sessions` — see the doc comment on
   * `markSessionFailed` below for why the internal id alone is not safe to
   * trust here.
   */
  readonly externalUserId: string;
  readonly sourceUrl: string;
  readonly topic?: string | null;
  readonly strategy: QuizSessionStrategy;
  readonly provider: QuizSessionProvider;
  readonly model: string;
  readonly questionCount: number;
  readonly errorMessage: string;
}

/**
 * Persistence seam for the generation pipeline (Story 2.6). Kept as its own
 * port — distinct from `QuizRepositoryPort` (session CRUD) — because its
 * `markSessionFailed` method has a fundamentally different transactional
 * contract (its own, separately-committed connection; see AD-9) than every
 * other method here, which rides the caller's existing request transaction.
 */
export interface QuizPersistencePort {
  /**
   * Rides the CALLER'S existing (ALS-scoped) request transaction. Inserts
   * `quiz_sessions` itself (status='ready') — there is deliberately no
   * separate, earlier 'pending' row it updates. Reusing the SAME id for a
   * pre-insert AND a later same-transaction update is harmless, but a
   * pre-insert on THIS transaction sharing an id with a possible
   * `markSessionFailed` attempt on a DIFFERENT connection is not (see that
   * method's doc comment) — so this port never creates a 'pending' row at
   * all; the only two terminal writes are this one (ready) and
   * `markSessionFailed` (failed), each a single INSERT on its own
   * connection, so neither can ever contend for the same row lock.
   */
  persistGeneratedQuiz(input: PersistGeneratedQuizInput): Promise<void>;
  /**
   * Opens a FRESH, independent transaction/connection with its own
   * `set_config('app.user_id', ...)` and durably persists `status='failed'`
   * — this must survive the request transaction's rollback, so it cannot
   * ride the ALS tx. Implemented as an idempotent upsert (not an UPDATE)
   * because the 'pending' row inserted earlier in the (about-to-roll-back)
   * request transaction is not yet visible to this fresh connection.
   *
   * Also re-upserts `users` by `externalUserId` inside this same fresh
   * transaction before inserting `quiz_sessions` — the request
   * transaction's own user upsert (`identity.interceptor.ts`) is about to
   * roll back too (this IS that request), so a first-time caller's `users`
   * row would not yet durably exist; inserting `quiz_sessions.user_id`
   * against it would violate the FK.
   */
  markSessionFailed(sessionId: string, params: FailedSessionParams): Promise<void>;
  /** Rides the CALLER'S existing (ALS-scoped) request transaction. */
  forUserSessionQuestions(sessionId: string): Promise<readonly SessionQuestionRowDto[]>;
}
