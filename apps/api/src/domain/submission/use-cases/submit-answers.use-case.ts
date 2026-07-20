// apps/api/src/domain/submission/use-cases/submit-answers.use-case.ts
//
// Plain exported function (not a NestJS-injectable class), consistent with
// the domain-purity pattern `apps/api/src/domain/quiz/use-cases/generate-quiz.ts`
// already established — domain code MUST NOT carry `@nestjs/*` decorators
// (AD-1/AD-2). The driving layer wires the concrete ports in and invokes
// this function directly.

import {
  aggregateByCategory,
  type CategoryPerformanceDto,
  geometricWeights,
  type QuestionDto,
  rankWeakCategories,
  scoreQuestion,
  type UserResponseDto,
  weightedFinalScore,
} from '@ai-quiz/shared';

import type { QuizRepositoryPort } from '../../ports/quiz-repository.port.js';
import type { InternalUserId } from '../../ports/user-repository.port.js';
import { NotFoundError } from '../../quiz/errors/not-found.error.js';
import type { SubmitRequestDto, SubmitResponseDto } from '../dto/submission.schemas.js';
import { IncompleteSubmissionError } from '../errors/incomplete-submission.error.js';
import { SessionNotReadyError } from '../errors/session-not-ready.error.js';
import type {
  ScoredResponseInput,
  SubmissionRepositoryPort,
} from '../ports/submission-repository.port.js';
import { buildInsights } from '../services/category-aggregator.service.js';
import { selectDocSnippets } from '../services/topic-snippet-matcher.js';

export interface SubmitAnswersDeps {
  readonly quizRepo: QuizRepositoryPort;
  readonly submissionRepo: SubmissionRepositoryPort;
}

export async function submitAnswers(
  sessionId: string,
  userId: InternalUserId,
  request: SubmitRequestDto,
  deps: SubmitAnswersDeps,
): Promise<SubmitResponseDto> {
  const session = await deps.quizRepo.findByIdAndUserId(sessionId, userId);
  if (!session) throw new NotFoundError();

  // Already-submitted: the cached result is authoritative regardless of what
  // the retried payload contains (AD-15). No request-body validation runs
  // on this branch.
  if (session.status === 'submitted') {
    const cached = await deps.submissionRepo.getSubmittedResult(sessionId, userId);
    if (!cached) throw new NotFoundError();
    return cached;
  }

  if (session.status === 'pending' || session.status === 'failed') {
    throw new SessionNotReadyError(session.status);
  }

  // status === 'ready'
  const questionsWithAnswers = await deps.submissionRepo.findQuestionsWithAnswersForUser(
    sessionId,
    userId,
  );
  if (!questionsWithAnswers) throw new NotFoundError();

  const sessionQuestionIds = new Set(questionsWithAnswers.map((q) => q.id));
  const requestQuestionIds = new Set(request.responses.map((r) => r.questionId));
  const missing = [...sessionQuestionIds].filter((id) => !requestQuestionIds.has(id));
  const extra = [...requestQuestionIds].filter((id) => !sessionQuestionIds.has(id));
  if (
    missing.length > 0 ||
    extra.length > 0 ||
    request.responses.length !== questionsWithAnswers.length
  ) {
    throw new IncompleteSubmissionError(
      `submission must contain exactly one response per session question ` +
        `(expected ${questionsWithAnswers.length}, got ${request.responses.length}; ` +
        `missing=${missing.length}, extra=${extra.length})`,
    );
  }

  const byId = new Map(questionsWithAnswers.map((q) => [q.id, q]));
  const n = questionsWithAnswers.length;
  const weights = geometricWeights(n);

  const scoredResponses: ScoredResponseInput[] = [];
  const breakdown: SubmitResponseDto['breakdown'] = [];
  const userResponseDtos: UserResponseDto[] = [];

  for (const response of request.responses) {
    // AC #1: every response ID was already proven to exist in `byId` above
    // (requestQuestionIds ⊆ sessionQuestionIds), so this lookup cannot miss.
    const question = byId.get(response.questionId);
    if (!question)
      throw new IncompleteSubmissionError(`unknown question id ${response.questionId}`);

    const weight = weights[question.position];
    if (weight === undefined) {
      throw new IncompleteSubmissionError(
        `question position ${question.position} out of range for a ${n}-question session`,
      );
    }

    // AC #3: position resolved from `questions.position` by `question_id`,
    // never from the request array index.
    const correctAnswers = question.answers
      .filter((answer) => answer.isCorrect)
      .map((answer) => answer.position)
      .sort((a, b) => a - b);
    const rawScore = scoreQuestion(question.type, correctAnswers, [...response.selected]);
    const weightedScore = rawScore * weight;

    scoredResponses.push({
      questionId: question.id,
      position: question.position,
      selected: response.selected,
      rawScore,
      weight,
      weightedScore,
    });
    breakdown.push({
      questionId: question.id,
      position: question.position,
      rawScore,
      weight,
      weightedScore,
      correctAnswers,
      selected: [...response.selected],
    });
    userResponseDtos.push({
      questionId: question.id,
      selected: [...response.selected],
      rawScore,
      weight,
      weightedScore,
    });
  }

  breakdown.sort((a, b) => a.position - b.position);

  const finalScore = weightedFinalScore(
    scoredResponses.map((r) => ({ rawScore: r.rawScore, position: r.position })),
  );

  const questionDtos: QuestionDto[] = questionsWithAnswers.map((q) => ({
    id: q.id,
    sessionId: q.sessionId,
    position: q.position,
    text: q.text,
    type: q.type,
    category: q.category,
    explanation: q.explanation,
  }));
  const categoryBreakdown: CategoryPerformanceDto[] = aggregateByCategory(
    questionDtos,
    userResponseDtos,
  );

  const documentChunks = await deps.submissionRepo.findDocumentChunksForUser(sessionId, userId);
  const weakCategories = rankWeakCategories(categoryBreakdown).filter(
    (category) => category.strength === 'weak',
  );
  const docSnippetsByCategory = new Map<string, string[]>();
  for (const category of weakCategories) {
    const categoryText = questionsWithAnswers
      .filter((q) => q.category === category.name)
      .map((q) => [q.text, ...q.answers.map((a) => a.text)].join(' '))
      .join(' ');
    docSnippetsByCategory.set(category.name, selectDocSnippets(categoryText, documentChunks));
  }

  const insights = buildInsights(categoryBreakdown, docSnippetsByCategory);
  const actualCount = n < session.questionCount ? n : undefined;

  const { won } = await deps.submissionRepo.trySubmit({
    sessionId,
    userId,
    responses: scoredResponses,
    finalScore,
    categoryBreakdown,
    insights,
    actualCount,
  });

  if (won) {
    return Object.freeze({
      sessionId,
      finalScore,
      actualCount,
      breakdown,
      categoryBreakdown,
      insights,
    });
  }

  // Lost the race to a concurrent submit — same shape, read from the winner's
  // committed rows rather than re-scoring this (possibly different) payload.
  const cached = await deps.submissionRepo.getSubmittedResult(sessionId, userId);
  if (!cached) throw new NotFoundError();
  return cached;
}
