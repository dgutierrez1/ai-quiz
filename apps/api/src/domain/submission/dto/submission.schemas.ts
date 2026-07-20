// apps/api/src/domain/submission/dto/submission.schemas.ts
//
// Story 3.1 — local Zod schemas for the submit/result boundary. These are
// NOT in `packages/shared/src/schemas.ts` because this story's file
// ownership is scoped to `apps/api/src/domain/submission/**` only (a
// concurrently-running agent owns `packages/shared` for this iteration).
// Flagged for promotion to `packages/shared/src/schemas.ts` in a follow-up —
// see the story's Dev Notes ("AD-3 — Zod DTOs, one schema per boundary").
//
// AD-3 "row ≠ request ≠ wire" split, mirrored here:
//   - `SubmitRequestSchema`       — inbound wire (POST /submit body)
//   - `UserResponseRowSchema`     — DB row shape (user_responses)
//   - `InsightsRowSchema`         — DB row shape (insights)
//   - `KnowledgeCategoryRowSchema`— DB row shape (knowledge_categories)
//   - `SubmitResponseSchema`      — outbound wire (POST /submit response)

import { CategoryPerformanceSchema, PositionSetSchema } from '@ai-quiz/shared';
import { z } from 'zod';

// ── Inbound wire ──────────────────────────────────────────────────────────

// Layers Story 1.2's `PositionSetSchema` (unique positions in [0,3]) with an
// additional non-empty refine. Deliberately does NOT touch
// `PositionSetSchema` itself, which stays usable for scoring.ts's own
// empty-array pure-function tests (AC #2).
export const SubmitAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selected: PositionSetSchema.refine((positions) => positions.length >= 1, {
    message: 'selected must contain at least one position',
  }),
});

export const SubmitRequestSchema = z
  .object({
    responses: z.array(SubmitAnswerSchema),
  })
  .strict();

// ── Row schemas (DB shape) ───────────────────────────────────────────────

export const UserResponseRowSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  questionId: z.string().uuid(),
  selected: PositionSetSchema,
  rawScore: z.number(),
  weight: z.number(),
  weightedScore: z.number(),
  submittedAt: z.date(),
});

export const TopicToStudySchema = z.object({
  topic: z.string(),
  reason: z.string(),
  docSnippets: z.array(z.string()),
});

export const InsightsSchema = z.object({
  topicsToStudy: z.array(TopicToStudySchema),
  weakCategories: z.array(z.string()),
  // AC #7 bug fix: a map keyed by category name, never a bare scalar.
  strengthByCategory: z.record(z.string(), z.enum(['strong', 'mixed', 'weak'])),
});

export const InsightsRowSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  kind: z.literal('gap_analysis'),
  payload: InsightsSchema,
  sources: z.array(z.string()).nullable(),
  createdAt: z.date(),
});

export const KnowledgeCategoryRowSchema = CategoryPerformanceSchema.extend({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
});

// ── Outbound wire ─────────────────────────────────────────────────────────

export const QuestionResultSchema = z.object({
  questionId: z.string().uuid(),
  position: z.number().int(),
  rawScore: z.number(),
  weight: z.number(),
  weightedScore: z.number(),
  correctAnswers: PositionSetSchema,
  // The user's own selection for this question, taken from `request.selected`
  // on the sync submit path or hydrated from `user_responses.selected` on
  // the cached path. The FE results breakdown renders this as the
  // "Your selection" tag + `data-selected` attribute per row.
  selected: PositionSetSchema,
});

export const SubmitResponseSchema = z.object({
  sessionId: z.string().uuid(),
  finalScore: z.number(),
  actualCount: z.number().int().optional(),
  breakdown: z.array(QuestionResultSchema),
  categoryBreakdown: z.array(CategoryPerformanceSchema),
  insights: InsightsSchema,
});

export type SubmitAnswerDto = z.infer<typeof SubmitAnswerSchema>;
export type SubmitRequestDto = z.infer<typeof SubmitRequestSchema>;
export type UserResponseRowDto = z.infer<typeof UserResponseRowSchema>;
export type TopicToStudyDto = z.infer<typeof TopicToStudySchema>;
export type InsightsDto = z.infer<typeof InsightsSchema>;
export type InsightsRowDto = z.infer<typeof InsightsRowSchema>;
export type KnowledgeCategoryRowDto = z.infer<typeof KnowledgeCategoryRowSchema>;
export type QuestionResultDto = z.infer<typeof QuestionResultSchema>;
export type SubmitResponseDto = z.infer<typeof SubmitResponseSchema>;
