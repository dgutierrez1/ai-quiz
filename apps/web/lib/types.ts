import type {
  CategoryPerformanceDto,
  CreatedQuestionDto,
  QuizSessionStatus,
  SessionQuestionWireDto,
} from '@ai-quiz/shared';

/**
 * Local working-assumption types for `GET /api/sessions/:id` and
 * `POST /api/sessions/:id/submit` (Stories 3.2 / 3.3).
 *
 * Story 3.1 (concurrent authorship — see epics.md) owns the canonical
 * backend schema in `packages/shared/src/schemas.ts`. As of this story,
 * `apps/api/src/driving/sessions/sessions.controller.ts` only implements a
 * bare `GET /sessions/:id` (returns the raw row, no typed wire projection)
 * and has no `/submit` route at all. These types encode the documented
 * working assumption from the 3.2/3.3 story files' Dev Notes → "API
 * contract this story consumes" / "POST /submit — request/response
 * contract". They live here (not in `@ai-quiz/shared`) because this repo's
 * file-ownership convention reserves `packages/shared/**` for Story 3.1.
 *
 * Every consumer of these types MUST treat missing/extra fields
 * defensively (optional chaining, fallback to "absent") rather than
 * throwing — the architecture spine's own "Deferred" list (N6, N8) flags
 * exactly this gap as open. When Story 3.1 lands its schema, reconcile
 * these types against it rather than letting this file silently diverge.
 */

export interface InsightTopic {
  readonly topic?: string;
  readonly reason?: string;
  readonly docSnippets?: readonly string[];
}

export interface SessionInsights {
  readonly topicsToStudy?: readonly InsightTopic[];
  readonly weakCategories?: readonly string[];
}

export interface QuestionResultDto {
  readonly questionId: string;
  readonly position: number;
  readonly rawScore: number;
  readonly weight: number;
  readonly weightedScore: number;
  readonly correctAnswers: readonly number[];
  /** The user's own selected positions for this question — required on the wire (QuestionResultSchema). */
  readonly selected: readonly number[];
}

interface SessionDetailBase {
  readonly sessionId: string;
  readonly status: QuizSessionStatus;
  readonly errorMessage?: string | null;
  /** Present when the generator produced fewer questions than requested. */
  readonly actualCount?: number | null;
  /** The originally requested question count, when the payload carries it. */
  readonly questionCount?: number;
}

export interface ReadySessionDetail extends SessionDetailBase {
  readonly status: 'ready';
  readonly questions: readonly SessionQuestionWireDto[];
}

export interface PendingSessionDetail extends SessionDetailBase {
  readonly status: 'pending';
}

export interface FailedSessionDetail extends SessionDetailBase {
  readonly status: 'failed';
}

export interface SubmittedSessionDetail extends SessionDetailBase {
  readonly status: 'submitted';
  readonly finalScore: number;
  readonly breakdown: readonly QuestionResultDto[];
  readonly categoryBreakdown: readonly CategoryPerformanceDto[];
  readonly insights?: SessionInsights;
  /**
   * Full question/answer set with `isCorrect` revealed — this story's
   * working assumption per Story 3.2's Dev Notes (not yet pinned upstream).
   */
  readonly questions?: readonly CreatedQuestionDto[];
}

export type SessionDetailResponse =
  ReadySessionDetail | PendingSessionDetail | FailedSessionDetail | SubmittedSessionDetail;

export interface SubmitAnswerInput {
  readonly questionId: string;
  readonly selected: readonly number[];
}

export interface SubmitAnswersRequest {
  readonly responses: readonly SubmitAnswerInput[];
}

export interface SubmitAnswersResponse {
  readonly sessionId: string;
  readonly finalScore: number;
  readonly breakdown: readonly QuestionResultDto[];
  readonly categoryBreakdown: readonly CategoryPerformanceDto[];
  readonly insights?: SessionInsights;
  readonly actualCount?: number;
}
