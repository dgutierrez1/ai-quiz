import type { SessionQuestionRowDto } from '@ai-quiz/shared';
import { describe, expect, it } from 'vitest';

import { RedactedQuestionSchema } from '../../src/domain/chat/dto/chat.schemas.js';
import {
  buildReadyContext,
  buildSubmittedContext,
  redactQuestionsForChat,
} from '../../src/domain/chat/services/chat-context.service.js';

const SECRET_ANSWER_TEXT = 'The capital of Freedonia is Definitely-Not-A-Hint-City';
const SECRET_QUESTION_TEXT = 'What is the capital of Freedonia, a fictional secret nation?';

const QUESTIONS: readonly SessionQuestionRowDto[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    position: 0,
    text: SECRET_QUESTION_TEXT,
    type: 'single',
    category: 'Geography',
    explanation: 'Because that is the correct capital, per the source document.',
    answers: [
      { position: 0, text: SECRET_ANSWER_TEXT, isCorrect: true },
      { position: 1, text: 'Wrong A', isCorrect: false },
      { position: 2, text: 'Wrong B', isCorrect: false },
      { position: 3, text: 'Wrong C', isCorrect: false },
    ],
  },
];

describe('redactQuestionsForChat (Story 4.1 AD-12)', () => {
  it('produces exactly {id, position, category, type} — structural key-set assertion', () => {
    const redacted = redactQuestionsForChat(QUESTIONS);
    expect(redacted).toHaveLength(1);
    expect(Object.keys(redacted[0]!).sort()).toEqual(['category', 'id', 'position', 'type']);
  });

  it('never leaks question or answer text under any key name — content-level assertion', () => {
    const redacted = redactQuestionsForChat(QUESTIONS);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(SECRET_ANSWER_TEXT);
    expect(serialized).not.toContain(SECRET_QUESTION_TEXT);
    expect(serialized).not.toContain('isCorrect');
    expect(serialized).not.toContain('explanation');
  });

  it('parses through RedactedQuestionSchema.strict() — an accidental extra key throws, not silently passes', () => {
    expect(() =>
      RedactedQuestionSchema.parse({
        id: QUESTIONS[0]!.id,
        position: 0,
        category: 'Geography',
        type: 'single',
        text: 'leaked!',
      }),
    ).toThrow();
  });

  it('buildReadyContext never embeds the raw question/answer content it was not given', () => {
    const context = buildReadyContext(redactQuestionsForChat(QUESTIONS));
    expect(context).not.toContain(SECRET_ANSWER_TEXT);
    expect(context).not.toContain(SECRET_QUESTION_TEXT);
    expect(context).toContain('Geography');
  });
});

describe('buildSubmittedContext (Story 4.1 AC #5 + #12)', () => {
  it('includes full question/answer content plus the scoring + insights payload', () => {
    const context = buildSubmittedContext({
      finalScore: 4,
      breakdown: [
        {
          questionId: QUESTIONS[0]!.id,
          position: 0,
          rawScore: 4,
          weight: 1,
          weightedScore: 4,
          correctAnswers: [0],
          selected: [0],
        },
      ],
      categoryBreakdown: [
        {
          name: 'Geography',
          questionCount: 1,
          correctCount: 1,
          avgRawScore: 4,
          weightedScore: 4,
          strength: 'strong',
        },
      ],
      insights: {
        topicsToStudy: [{ topic: 'Geography', reason: 'weak', docSnippets: ['snippet'] }],
        weakCategories: [],
      },
      questions: QUESTIONS,
    });
    expect(context).toContain(SECRET_ANSWER_TEXT);
    expect(context).toContain(SECRET_QUESTION_TEXT);
    expect(context).toContain('"finalScore":4');
  });

  it('strips `selected` from the breakdown before serializing into the LLM context', () => {
    const context = buildSubmittedContext({
      finalScore: 4,
      breakdown: [
        {
          questionId: QUESTIONS[0]!.id,
          position: 0,
          rawScore: 4,
          weight: 1,
          weightedScore: 4,
          correctAnswers: [0],
          selected: [2],
        },
      ],
      categoryBreakdown: [
        {
          name: 'Geography',
          questionCount: 1,
          correctCount: 1,
          avgRawScore: 4,
          weightedScore: 4,
          strength: 'strong',
        },
      ],
      insights: {
        topicsToStudy: [],
        weakCategories: [],
      },
      questions: QUESTIONS,
    });
    // Extract just the serialized breakdown portion of the payload so the
    // assertion is structural (not fragile to coincidental `[2]` in
    // question.answers[].position values elsewhere in the context).
    const breakdownMatch = context.match(/"breakdown":(\[[^\]]*\])/);
    expect(breakdownMatch).not.toBeNull();
    const breakdownJson = breakdownMatch![1]!;
    // `selected` is on the wire (for the FE "Your selection" tag) but must
    // not reach the LLM context — correctness vs. the user's pick is
    // already derivable from `correctAnswers` + `rawScore`.
    expect(breakdownJson).not.toContain('"selected"');
    // Sanity: the rest of the breakdown is still present.
    expect(breakdownJson).toContain('"correctAnswers":[0]');
  });
});
