// packages/shared/src/dto.ts
//
// Public type re-exports for `@ai-quiz/shared`. The Zod schemas live in
// `schemas.ts` and are the single source of truth; this module re-exports
// the derived types via `z.infer<typeof X>` (no hand-written interfaces —
// drift risk per architecture-spec.md §A.9).
//
// Cross-boundary types (inbound HTTP, outbound adapters, DB rows, LLM JSON)
// are declared in `schemas.ts` and surfaced here. Domain scoring types
// stay in `scoring.ts` and are re-exported from `index.ts` directly.

export type {
  AnswerPosition,
  CategoryPerformanceDto,
  CategoryStrength,
  CreatedQuestionDto,
  CreateSessionRequest,
  GeneratedAnswerDto,
  GeneratedQuestionDto,
  IngestedDocumentDto,
  ProviderListResponse,
  QuestionDto,
  QuestionPoolDto,
  QuestionType,
  QuizSessionProvider,
  QuizSessionRow,
  QuizSessionStatus,
  QuizSessionStrategy,
  SessionCreatedResponse,
  SubmittedAnswerDto,
  UserIdHeader,
  UserResponseDto,
  UserRow,
} from './schemas';
