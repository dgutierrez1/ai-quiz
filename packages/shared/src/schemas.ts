// packages/shared/src/schemas.ts
//
// Zod schemas consumed by the scoring module (Story 1.2) and by future
// adapter / use-case layers (Story 1.4+). The schemas here are **scoring-
// relevant only** — session, document, chat, LLM-output schemas belong to
// Stories 1.3 / 1.4 and Epic 2 and must not be added.
//
// Source of truth (AD-3): this file is the single place where the shape of
// `QuestionDto`, `UserResponseDto`, and `CategoryPerformanceDto` is defined.
// Every other layer derives the type via `z.infer` — no hand-written
// interfaces (drift risk #1 per architecture-spec.md §A.9).
//
// Position validation: `PositionSetSchema` is the SINGLE enforcement point
// for "unique integers in [0, 3]". `scoreQuestion` reuses it via `.parse()`;
// it does not duplicate the check.

import { z } from 'zod';

// ── Position primitives ──────────────────────────────────────────────────────

export const AnswerPositionSchema = z.number().int().min(0).max(3);

export const PositionSetSchema = z
  .array(AnswerPositionSchema)
  .refine((positions) => new Set(positions).size === positions.length, {
    message: 'positions must be unique',
  });

// ── Scoring DTOs (mirror of architecture-spec.md §A.4) ───────────────────────

export const QuestionTypeSchema = z.enum(['single', 'multiple']);

export const QuestionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  position: z.number().int().nonnegative(),
  text: z.string().max(500),
  type: QuestionTypeSchema,
  category: z.string(),
  explanation: z.string(),
});

export const UserResponseSchema = z.object({
  questionId: z.string(),
  selected: PositionSetSchema,
  rawScore: z.number(),
  weight: z.number(),
  weightedScore: z.number(),
});

export const CategoryStrengthSchema = z.enum(['strong', 'mixed', 'weak']);

export const CategoryPerformanceSchema = z.object({
  name: z.string(),
  questionCount: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  avgRawScore: z.number(),
  weightedScore: z.number(),
  strength: CategoryStrengthSchema,
});

export const UserRowSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string().min(1),
  createdAt: z.date(),
});

export const QuizSessionStrategySchema = z.enum(['factual', 'comprehension', 'mixed', 'trivia']);

export const QuizSessionProviderSchema = z.enum(['minimax', 'openrouter']);
export const QuizSessionStatusSchema = z.enum(['pending', 'ready', 'submitted', 'failed']);

export type QuizSessionStrategy = z.infer<typeof QuizSessionStrategySchema>;
export type QuizSessionProvider = z.infer<typeof QuizSessionProviderSchema>;
export type QuizSessionStatus = z.infer<typeof QuizSessionStatusSchema>;

export const QuizSessionRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  sourceUrl: z.string().url(),
  topic: z.string().max(200).nullable(),
  strategy: QuizSessionStrategySchema,
  provider: QuizSessionProviderSchema,
  model: z.string().min(1),
  status: QuizSessionStatusSchema,
  errorMessage: z.string().nullable(),
  questionCount: z.number().int().min(5).max(8),
  actualCount: z.number().int().min(0).max(8).nullable(),
  selectedCategories: z.array(z.string()).default([]),
  finalScore: z.number().nullable(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
});

// ── API / persistence boundary DTOs ───────────────────────────────────────────

export const UserIdHeaderSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'X-User-Id must be a UUID v4',
  );

export const CreateSessionRequestSchema = z.object({
  sourceUrl: z.string().url(),
  topic: z.string().max(200).optional(),
  strategy: QuizSessionStrategySchema.default('mixed'),
  questionCount: z.number().int().min(5).max(8).default(8),
  provider: QuizSessionProviderSchema.default('minimax'),
  model: z.string().min(1).default('MiniMax-M3'),
});

export const SessionCreatedResponseSchema = z.object({
  id: z.string().uuid(),
  status: QuizSessionStatusSchema,
  actualCount: z.number().int().min(5).max(8).optional(),
});

export const IngestedDocumentSchema = z
  .object({
    url: z.string().url(),
    content: z.string(),
    contentType: z.enum(['text/markdown', 'text/plain']),
    byteSize: z.number().int().nonnegative(),
  })
  .strict();

export const AnswerSchema = z.object({
  position: AnswerPositionSchema,
  text: z.string().min(1).max(500),
  isCorrect: z.boolean(),
});

export const GeneratedQuestionSchema = z
  .object({
    text: z.string().min(1).max(500),
    type: QuestionTypeSchema,
    category: z.string().trim().min(1).max(100),
    explanation: z.string().max(2000),
    answers: z.array(AnswerSchema).length(4),
  })
  .superRefine((question, context) => {
    const correct = question.answers.filter((answer) => answer.isCorrect).length;
    if (question.type === 'single' && correct !== 1) {
      context.addIssue({ code: 'custom', message: 'single questions require exactly one answer' });
    }
    if (question.type === 'multiple' && (correct < 2 || correct > 4)) {
      context.addIssue({ code: 'custom', message: 'multiple questions require 2-4 answers' });
    }
    const positions = question.answers.map((answer) => answer.position);
    if (new Set(positions).size !== 4) {
      context.addIssue({ code: 'custom', message: 'answer positions must be unique' });
    }
  });

export const QuestionPoolSchema = z.object({
  questions: z.array(GeneratedQuestionSchema).min(1),
});

export const SubmittedAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selected: PositionSetSchema,
});

export const GeneratedAnswerSchema = z.object({
  position: AnswerPositionSchema,
  text: z.string().min(1).max(500),
  isCorrect: z.boolean(),
});

export const CreatedQuestionSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  position: z.number().int().nonnegative(),
  text: z.string().min(1).max(500),
  type: QuestionTypeSchema,
  category: z.string().min(1).max(100),
  explanation: z.string().max(2000),
  answers: z.array(GeneratedAnswerSchema).length(4),
});

// Row schema (in-app representation): isCorrect lives here because the
// persistence layer needs it to score submissions.
export const SessionQuestionRowSchema = CreatedQuestionSchema;

// Wire schema (outbound): the user must never see which answer is correct
// before submitting. The projection strips `isCorrect`.
export const SessionQuestionWireSchema = CreatedQuestionSchema.omit({ answers: true }).extend({
  answers: z.array(GeneratedAnswerSchema.omit({ isCorrect: true })),
});

export const SessionQuestionsResponseSchema = z.object({
  sessionId: z.string().uuid(),
  status: QuizSessionStatusSchema,
  questions: z.array(SessionQuestionWireSchema).min(0),
  selectedCategories: z.array(z.string()).default([]),
});

export const ProviderListResponseSchema = z.object({
  minimax: z.array(z.string()).optional(),
  openrouter: z.array(z.string()).optional(),
});

export type QuestionDto = z.infer<typeof QuestionSchema>;
export type UserResponseDto = z.infer<typeof UserResponseSchema>;
export type CategoryPerformanceDto = z.infer<typeof CategoryPerformanceSchema>;
export type QuestionType = z.infer<typeof QuestionTypeSchema>;
export type CategoryStrength = z.infer<typeof CategoryStrengthSchema>;
export type UserRow = z.infer<typeof UserRowSchema>;
export type QuizSessionRow = z.infer<typeof QuizSessionRowSchema>;
export type UserIdHeader = z.infer<typeof UserIdHeaderSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type SessionCreatedResponse = z.infer<typeof SessionCreatedResponseSchema>;
export type IngestedDocumentDto = z.infer<typeof IngestedDocumentSchema>;
export type GeneratedQuestionDto = z.infer<typeof GeneratedQuestionSchema>;
export type QuestionPoolDto = z.infer<typeof QuestionPoolSchema>;
export type ProviderListResponse = z.infer<typeof ProviderListResponseSchema>;

export type SubmittedAnswerDto = z.infer<typeof SubmittedAnswerSchema>;
export type GeneratedAnswerDto = z.infer<typeof GeneratedAnswerSchema>;
export type CreatedQuestionDto = z.infer<typeof CreatedQuestionSchema>;
export type AnswerPosition = z.infer<typeof AnswerPositionSchema>;

export type SessionQuestionRowDto = z.infer<typeof SessionQuestionRowSchema>;
export type SessionQuestionWireDto = z.infer<typeof SessionQuestionWireSchema>;
export type SessionQuestionsResponseDto = z.infer<typeof SessionQuestionsResponseSchema>;
