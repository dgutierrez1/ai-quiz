// apps/api/src/domain/submission/ports/submission-repository.port.ts
//
// A dedicated port rather than further overloading `QuizRepositoryPort`,
// given the growing surface area (3 new tables). See Story 3.1 Task 4.

import type { CategoryPerformanceDto, SessionQuestionRowDto } from '@ai-quiz/shared';

import type { InternalUserId } from '../../ports/user-repository.port.js';
import type { InsightsDto, SubmitResponseDto } from '../dto/submission.schemas.js';

export interface ScoredResponseInput {
  readonly questionId: string;
  readonly position: number;
  readonly selected: readonly number[];
  readonly rawScore: number;
  readonly weight: number;
  readonly weightedScore: number;
}

export interface TrySubmitInput {
  readonly sessionId: string;
  readonly userId: InternalUserId;
  readonly responses: readonly ScoredResponseInput[];
  readonly finalScore: number;
  readonly categoryBreakdown: readonly CategoryPerformanceDto[];
  readonly insights: InsightsDto;
  readonly actualCount?: number;
}

export interface SubmissionRepositoryPort {
  /**
   * Internal read (includes `isCorrect`, needed to score). Null on
   * not-found/not-owned. Distinct from the outbound `SessionQuestionWireSchema`
   * projection, which hides `isCorrect` pre-submit.
   */
  findQuestionsWithAnswersForUser(
    sessionId: string,
    userId: InternalUserId,
  ): Promise<readonly SessionQuestionRowDto[] | null>;

  findDocumentChunksForUser(sessionId: string, userId: InternalUserId): Promise<readonly string[]>;

  /**
   * The sole write path. Attempts the atomic
   * `UPDATE quiz_sessions SET status='submitted' ... WHERE status='ready' RETURNING`.
   * If it affects a row, this call is the race winner and — within the same
   * request transaction — also inserts `user_responses`, upserts
   * `knowledge_categories`, and inserts `insights`, returning `{won: true}`.
   * If it affects 0 rows, no further writes happen and `{won: false}` is
   * returned; the caller falls back to `getSubmittedResult`.
   */
  trySubmit(input: TrySubmitInput): Promise<{ readonly won: boolean }>;

  /**
   * Pure read: joins `quiz_sessions.final_score` + `user_responses` +
   * `questions`/`answers` + `knowledge_categories` + `insights.payload`.
   * Returns null if the session isn't `submitted` or doesn't exist/isn't
   * owned.
   */
  getSubmittedResult(sessionId: string, userId: InternalUserId): Promise<SubmitResponseDto | null>;
}
