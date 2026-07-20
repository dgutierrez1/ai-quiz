// apps/api/src/domain/chat/services/chat-context.service.ts
//
// Story 4.1 Task 4 — pure domain service (no I/O, AD-2). This is the
// concrete implementation of AD-12's pre-submit guard: `redactQuestionsForChat`
// is a SCHEMA-LEVEL PROJECTION (parses a brand-new object into
// `RedactedQuestionSchema`), never a runtime `delete` on the full row. A
// `delete`-based approach is one missed field away from leaking; parsing
// from scratch makes an accidentally-widened schema fail loudly at the
// `.strict()` boundary instead of silently passing extra keys through.
//
// No cache-prefix persistence anywhere in this file or its callers — this
// resolves the spine's "Chat cache prefix vs grounding chunks" Deferred item
// by explicit omission (Story 4.1 design ruling #4). Context is recomputed
// fresh per turn from the redacted/full projection, never from a stored
// prefix that could carry source chunks (which contain every answer by
// construction).

import type { SessionQuestionRowDto } from '@ai-quiz/shared';

import type { SubmitResponseDto } from '../../submission/dto/submission.schemas.js';
import { type RedactedQuestionDto, RedactedQuestionSchema } from '../dto/chat.schemas.js';

/**
 * AD-12 — maps each full question row to `{id, position, category, type}`
 * via `Object.freeze(RedactedQuestionSchema.parse(...))`. The output never
 * contains `text`, `answers`, or `isCorrect` — enforced by `.strict()`, not
 * by convention.
 */
export function redactQuestionsForChat(
  questions: readonly SessionQuestionRowDto[],
): readonly RedactedQuestionDto[] {
  return questions.map((question) =>
    Object.freeze(
      RedactedQuestionSchema.parse({
        id: question.id,
        position: question.position,
        category: question.category,
        type: question.type,
      }),
    ),
  );
}

const READY_SYSTEM_PREAMBLE =
  'You are a study-companion chat assistant for an in-progress quiz session. ' +
  'The user has NOT submitted their answers yet. You must NEVER reveal, hint at, ' +
  'or discuss which answer option is correct for any question, and you must NEVER ' +
  'quote or restate question or answer text you were not given below — you were only ' +
  'given a redacted list of question metadata (id, position, category, type), by design. ' +
  'You may discuss the general topic/category of a question and offer study guidance, ' +
  'but never the specific content or correctness of any answer.';

export function buildReadyContext(redacted: readonly RedactedQuestionDto[]): string {
  return [READY_SYSTEM_PREAMBLE, `Session questions (redacted): ${JSON.stringify(redacted)}`].join(
    '\n\n',
  );
}

const SUBMITTED_SYSTEM_PREAMBLE =
  'You are a study-companion chat assistant for a completed quiz session. ' +
  'The user has already submitted their answers and can see their full results. ' +
  'You have the full question/answer content plus their scoring and gap-analysis ' +
  'insights below — use them to explain answers, discuss mistakes, and support ' +
  '"Explain Q3"-style follow-ups and general gap-analysis conversation.';

export interface SubmittedContextInput {
  readonly finalScore: number;
  readonly breakdown: SubmitResponseDto['breakdown'];
  readonly categoryBreakdown: SubmitResponseDto['categoryBreakdown'];
  readonly insights: {
    readonly topicsToStudy: SubmitResponseDto['insights']['topicsToStudy'];
    readonly weakCategories: SubmitResponseDto['insights']['weakCategories'];
  };
  readonly questions: readonly SessionQuestionRowDto[];
}

/**
 * AC #5 + AC #12 — the submitted-branch context is additive: full
 * per-question data (text + answers + isCorrect) PLUS the
 * finalScore/breakdown/categoryBreakdown/insights payload Story 3.1
 * produces. This function only forwards whatever shape Story 3.1 actually
 * built — it never recomputes scoring (that would duplicate
 * `packages/shared/scoring.ts`).
 *
 * `selected` is stripped from the breakdown before serialization: the
 * wire schema carries it for the FE "Your selection" tag, but it is not
 * part of the LLM's stated context (correctness is derivable from
 * `correctAnswers` + `rawScore` alone).
 */
export function buildSubmittedContext(input: SubmittedContextInput): string {
  const payload = {
    finalScore: input.finalScore,
    breakdown: input.breakdown.map(({ selected: _selected, ...rest }) => rest),
    categoryBreakdown: input.categoryBreakdown,
    insights: {
      topicsToStudy: input.insights.topicsToStudy,
      weakCategories: input.insights.weakCategories,
    },
    questions: input.questions,
  };
  return [
    SUBMITTED_SYSTEM_PREAMBLE,
    `Session results + questions: ${JSON.stringify(payload)}`,
  ].join('\n\n');
}
