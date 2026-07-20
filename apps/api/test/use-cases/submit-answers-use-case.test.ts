import type { QuizSessionRow, SessionQuestionRowDto } from '@ai-quiz/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuizRepositoryPort } from '../../src/domain/ports/quiz-repository.port.js';
import type { InternalUserId } from '../../src/domain/ports/user-repository.port.js';
import { NotFoundError } from '../../src/domain/quiz/errors/not-found.error.js';
import type {
  SubmitRequestDto,
  SubmitResponseDto,
} from '../../src/domain/submission/dto/submission.schemas.js';
import { IncompleteSubmissionError } from '../../src/domain/submission/errors/incomplete-submission.error.js';
import { SessionNotReadyError } from '../../src/domain/submission/errors/session-not-ready.error.js';
import type { SubmissionRepositoryPort } from '../../src/domain/submission/ports/submission-repository.port.js';
import { submitAnswers } from '../../src/domain/submission/use-cases/submit-answers.use-case.js';

const USER_ID = 'user-1' as InternalUserId;
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const Q1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Q2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeSession(overrides: Partial<QuizSessionRow> = {}): QuizSessionRow {
  return {
    id: SESSION_ID,
    userId: 'user-uuid',
    sourceUrl: 'https://example.com/doc.md',
    topic: null,
    strategy: 'mixed',
    provider: 'minimax',
    model: 'MiniMax-M3',
    status: 'ready',
    errorMessage: null,
    questionCount: 2,
    actualCount: 2,
    selectedCategories: ['Cat A'],
    finalScore: null,
    createdAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

function makeQuestions(): SessionQuestionRowDto[] {
  return [
    {
      id: Q1,
      sessionId: SESSION_ID,
      position: 0,
      text: 'Q1 text',
      type: 'single',
      category: 'Cat A',
      explanation: '',
      answers: [
        { position: 0, text: 'a', isCorrect: true },
        { position: 1, text: 'b', isCorrect: false },
        { position: 2, text: 'c', isCorrect: false },
        { position: 3, text: 'd', isCorrect: false },
      ],
    },
    {
      id: Q2,
      sessionId: SESSION_ID,
      position: 1,
      text: 'Q2 text',
      type: 'single',
      category: 'Cat A',
      explanation: '',
      answers: [
        { position: 0, text: 'a', isCorrect: false },
        { position: 1, text: 'b', isCorrect: true },
        { position: 2, text: 'c', isCorrect: false },
        { position: 3, text: 'd', isCorrect: false },
      ],
    },
  ];
}

function makeRequest(): SubmitRequestDto {
  return {
    responses: [
      { questionId: Q1, selected: [0] },
      { questionId: Q2, selected: [1] },
    ],
  };
}

describe('submitAnswers use-case', () => {
  let quizRepo: { findByIdAndUserId: ReturnType<typeof vi.fn> };
  let submissionRepo: {
    findQuestionsWithAnswersForUser: ReturnType<typeof vi.fn>;
    findDocumentChunksForUser: ReturnType<typeof vi.fn>;
    trySubmit: ReturnType<typeof vi.fn>;
    getSubmittedResult: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    quizRepo = { findByIdAndUserId: vi.fn() };
    submissionRepo = {
      findQuestionsWithAnswersForUser: vi.fn(),
      findDocumentChunksForUser: vi.fn().mockResolvedValue([]),
      trySubmit: vi.fn(),
      getSubmittedResult: vi.fn(),
    };
  });

  function deps() {
    return {
      quizRepo: quizRepo as unknown as QuizRepositoryPort,
      submissionRepo: submissionRepo as unknown as SubmissionRepositoryPort,
    };
  }

  it('throws NotFoundError when the session does not exist / is not owned', async () => {
    quizRepo.findByIdAndUserId.mockResolvedValue(null);
    await expect(submitAnswers(SESSION_ID, USER_ID, makeRequest(), deps())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws SessionNotReadyError(pending) for a pending session', async () => {
    quizRepo.findByIdAndUserId.mockResolvedValue(makeSession({ status: 'pending' }));
    await expect(submitAnswers(SESSION_ID, USER_ID, makeRequest(), deps())).rejects.toMatchObject({
      status: 'pending',
      name: 'SessionNotReadyError',
    });
  });

  it('throws SessionNotReadyError(failed) for a failed session', async () => {
    quizRepo.findByIdAndUserId.mockResolvedValue(makeSession({ status: 'failed' }));
    await expect(submitAnswers(SESSION_ID, USER_ID, makeRequest(), deps())).rejects.toBeInstanceOf(
      SessionNotReadyError,
    );
  });

  it('throws IncompleteSubmissionError when a question id is missing', async () => {
    quizRepo.findByIdAndUserId.mockResolvedValue(makeSession());
    submissionRepo.findQuestionsWithAnswersForUser.mockResolvedValue(makeQuestions());
    const request: SubmitRequestDto = { responses: [{ questionId: Q1, selected: [0] }] };
    await expect(submitAnswers(SESSION_ID, USER_ID, request, deps())).rejects.toBeInstanceOf(
      IncompleteSubmissionError,
    );
  });

  it('throws IncompleteSubmissionError when an extra question id is present', async () => {
    quizRepo.findByIdAndUserId.mockResolvedValue(makeSession());
    submissionRepo.findQuestionsWithAnswersForUser.mockResolvedValue(makeQuestions());
    const request: SubmitRequestDto = {
      responses: [
        { questionId: Q1, selected: [0] },
        { questionId: Q2, selected: [1] },
        { questionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', selected: [0] },
      ],
    };
    await expect(submitAnswers(SESSION_ID, USER_ID, request, deps())).rejects.toBeInstanceOf(
      IncompleteSubmissionError,
    );
  });

  it('scores correctly on the happy path and returns finalScore/breakdown/categoryBreakdown/insights', async () => {
    quizRepo.findByIdAndUserId.mockResolvedValue(makeSession());
    submissionRepo.findQuestionsWithAnswersForUser.mockResolvedValue(makeQuestions());
    submissionRepo.trySubmit.mockResolvedValue({ won: true });

    const result = await submitAnswers(SESSION_ID, USER_ID, makeRequest(), deps());

    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0]).toMatchObject({ questionId: Q1, position: 0, rawScore: 4 });
    expect(result.breakdown[1]).toMatchObject({ questionId: Q2, position: 1, rawScore: 4 });
    // Each breakdown row echoes the user's own selections so the FE can
    // render the "Your selection" tag + `data-selected` attribute.
    expect(result.breakdown[0]!.selected).toEqual([0]);
    expect(result.breakdown[1]!.selected).toEqual([1]);
    // Both answered fully correctly -> finalScore 4.
    expect(result.finalScore).toBe(4);
    expect(result.categoryBreakdown).toHaveLength(1);
    expect(result.categoryBreakdown[0]).toMatchObject({
      name: 'Cat A',
      avgRawScore: 4,
      strength: 'strong',
    });
    expect(result.insights.weakCategories).toEqual([]);
    expect(submissionRepo.trySubmit).toHaveBeenCalledTimes(1);
  });

  it('already-submitted session skips validation entirely and returns the cached result verbatim', async () => {
    quizRepo.findByIdAndUserId.mockResolvedValue(
      makeSession({ status: 'submitted', finalScore: 3.5 }),
    );
    const cached: SubmitResponseDto = {
      sessionId: SESSION_ID,
      finalScore: 3.5,
      breakdown: [],
      categoryBreakdown: [],
      insights: { topicsToStudy: [], weakCategories: [], strengthByCategory: {} },
    };
    submissionRepo.getSubmittedResult.mockResolvedValue(cached);

    // Deliberately malformed-relative-to-session request (wrong ids) — must
    // not be validated on this branch.
    const result = await submitAnswers(
      SESSION_ID,
      USER_ID,
      {
        responses: [{ questionId: 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz', selected: [0] }],
      } as unknown as SubmitRequestDto,
      deps(),
    );

    expect(result).toEqual(cached);
    expect(submissionRepo.findQuestionsWithAnswersForUser).not.toHaveBeenCalled();
  });

  it('won:false (lost the race) returns the same shape as won:true, read from the cached result', async () => {
    quizRepo.findByIdAndUserId.mockResolvedValue(makeSession());
    submissionRepo.findQuestionsWithAnswersForUser.mockResolvedValue(makeQuestions());
    submissionRepo.trySubmit.mockResolvedValue({ won: false });
    const cached: SubmitResponseDto = {
      sessionId: SESSION_ID,
      finalScore: 4,
      breakdown: [],
      categoryBreakdown: [],
      insights: { topicsToStudy: [], weakCategories: [], strengthByCategory: {} },
    };
    submissionRepo.getSubmittedResult.mockResolvedValue(cached);

    const result = await submitAnswers(SESSION_ID, USER_ID, makeRequest(), deps());
    expect(result).toEqual(cached);
  });
});
