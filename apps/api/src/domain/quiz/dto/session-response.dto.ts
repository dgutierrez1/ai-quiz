// Local wire-response schema for `POST /api/sessions` and
// `GET /api/sessions/:id`.
//
// NOT added to `packages/shared/src/schemas.ts` on purpose — that file is
// owned by a concurrent story slice and this task's brief says to define any
// new shared-shaped schema locally under `domain/quiz/dto/` instead. It
// composes entirely from already-exported `@ai-quiz/shared` schemas
// (`QuizSessionStatusSchema`, `SessionQuestionWireSchema` — the latter is
// already the isCorrect-free projection defined in Story 1.x/2.x's row-vs-
// wire split), so there is no duplicated source of truth for the pieces
// that matter for security (isCorrect never appears in this shape at all).
import {
  CategoryPerformanceSchema,
  CreatedQuestionSchema,
  QuizSessionStatusSchema,
  SessionQuestionWireSchema,
} from '@ai-quiz/shared';
import { z } from 'zod';

import { InsightsSchema, QuestionResultSchema } from '../../submission/dto/submission.schemas.js';

export const SessionGenerationResponseSchema = z.object({
  id: z.string().uuid(),
  status: QuizSessionStatusSchema,
  questionCount: z.number().int().min(5).max(8),
  // Present only when < the originally-requested questionCount (Story 2.6 AC #11).
  actualCount: z.number().int().min(0).max(8).optional(),
  selectedCategories: z.array(z.string()).optional(),
  questions: z.array(SessionQuestionWireSchema).optional(),
  errorMessage: z.string().optional(),
});

export type SessionGenerationResponse = z.infer<typeof SessionGenerationResponseSchema>;

// `GET /api/sessions/:id` for a `submitted` session — the results payload
// (Story 3.1's submit read model, reused here rather than re-derived) merged
// with the session's own identity fields. Deliberately a SEPARATE schema
// from `SessionGenerationResponseSchema` rather than a union on `questions`:
// a submitted session's questions carry `isCorrect` (revealed post-submit,
// needed by the results breakdown UI), while a `ready` session's questions
// go through `SessionQuestionWireSchema`, which strips it (security
// boundary — never leak the answer key pre-submit). Keeping these as two
// distinct schemas, rather than a `z.union([...])` of the two question
// shapes, avoids the union silently matching the narrower (isCorrect-free)
// member first and stripping the very field this schema exists to carry.
export const SessionResultResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal('submitted'),
  questionCount: z.number().int().min(5).max(8),
  actualCount: z.number().int().min(0).max(8).optional(),
  selectedCategories: z.array(z.string()).optional(),
  questions: z.array(CreatedQuestionSchema),
  finalScore: z.number(),
  breakdown: z.array(QuestionResultSchema),
  categoryBreakdown: z.array(CategoryPerformanceSchema),
  insights: InsightsSchema,
});

export type SessionResultResponse = z.infer<typeof SessionResultResponseSchema>;
