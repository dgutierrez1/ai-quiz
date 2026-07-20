import {
  CategoryPerformanceSchema,
  type SessionQuestionRowDto,
  SessionQuestionRowSchema,
} from '@ai-quiz/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { InternalUserId } from '../../../domain/ports/user-repository.port.js';
import {
  QuestionResultSchema,
  type SubmitResponseDto,
  SubmitResponseSchema,
} from '../../../domain/submission/dto/submission.schemas.js';
import type {
  SubmissionRepositoryPort,
  TrySubmitInput,
} from '../../../domain/submission/ports/submission-repository.port.js';
import { getRequestContext } from '../../../driving/middleware/request-context.js';
import {
  answers,
  documents,
  insights,
  knowledgeCategories,
  questions,
  quizSessions,
  userResponses,
} from './schema.js';

export class SubmissionRepository implements SubmissionRepositoryPort {
  public async findQuestionsWithAnswersForUser(
    sessionId: string,
    userId: InternalUserId,
  ): Promise<readonly SessionQuestionRowDto[] | null> {
    const tx = getRequestContext().tx;
    const sessionRows = await tx
      .select({ id: quizSessions.id })
      .from(quizSessions)
      .where(and(eq(quizSessions.id, sessionId), eq(quizSessions.userId, userId)))
      .limit(1);
    if (!sessionRows[0]) return null;

    const questionRows = await tx
      .select()
      .from(questions)
      .where(eq(questions.sessionId, sessionId))
      .orderBy(questions.position);
    if (questionRows.length === 0) return [];

    const questionIds = questionRows.map((q) => q.id);
    const answerRows = await tx
      .select()
      .from(answers)
      .where(inArray(answers.questionId, questionIds))
      .orderBy(answers.position);
    const answersByQuestion = new Map<string, typeof answerRows>();
    for (const answer of answerRows) {
      const bucket = answersByQuestion.get(answer.questionId) ?? [];
      bucket.push(answer);
      answersByQuestion.set(answer.questionId, bucket);
    }

    return questionRows.map((q) =>
      Object.freeze(
        SessionQuestionRowSchema.parse({
          id: q.id,
          sessionId: q.sessionId,
          position: q.position,
          text: q.text,
          type: q.type,
          category: q.category,
          explanation: q.explanation,
          answers: (answersByQuestion.get(q.id) ?? []).map((a) => ({
            position: a.position,
            text: a.text,
            isCorrect: a.isCorrect,
          })),
        }),
      ),
    );
  }

  public async findDocumentChunksForUser(
    sessionId: string,
    userId: InternalUserId,
  ): Promise<readonly string[]> {
    const tx = getRequestContext().tx;
    const sessionRows = await tx
      .select({ id: quizSessions.id })
      .from(quizSessions)
      .where(and(eq(quizSessions.id, sessionId), eq(quizSessions.userId, userId)))
      .limit(1);
    if (!sessionRows[0]) return [];

    const docRows = await tx
      .select({ chunks: documents.chunks })
      .from(documents)
      .where(eq(documents.sessionId, sessionId))
      .limit(1);
    return docRows[0]?.chunks ?? [];
  }

  /**
   * The atomic UPDATE gates BEFORE any child-table insert: Postgres
   * row-level locking serializes concurrent attempts against the same
   * session row, so only the winner ever reaches the inserts below — the
   * `UNIQUE(session_id, question_id)` constraint on `user_responses` is
   * never actually raced (see Story 3.1 Task 4 for the full rationale).
   *
   * `knowledge_categories` is upserted (`ON CONFLICT ... DO UPDATE`) rather
   * than insert-only: generation (Story 2.6) already seeds a skeleton row
   * per drawn category (`sessionId`/`name`/`questionCount` only, via
   * `quiz-persistence.repository.ts`), so a plain INSERT would violate the
   * `UNIQUE(session_id, name)` constraint on every submit. This repository
   * remains the sole writer of `correct_count`/`avg_raw_score`/
   * `weighted_score`/`strength` — generation never populates them.
   */
  public async trySubmit(input: TrySubmitInput): Promise<{ readonly won: boolean }> {
    const tx = getRequestContext().tx;
    const updated = await tx
      .update(quizSessions)
      .set({
        status: 'submitted',
        finalScore: input.finalScore,
        completedAt: new Date(),
        ...(input.actualCount !== undefined ? { actualCount: input.actualCount } : {}),
      })
      .where(
        and(
          eq(quizSessions.id, input.sessionId),
          eq(quizSessions.userId, input.userId),
          eq(quizSessions.status, 'ready'),
        ),
      )
      .returning({ id: quizSessions.id });
    if (!updated[0]) return { won: false };

    if (input.responses.length > 0) {
      await tx.insert(userResponses).values(
        input.responses.map((response) => ({
          sessionId: input.sessionId,
          questionId: response.questionId,
          selected: [...response.selected],
          rawScore: response.rawScore,
          weight: response.weight,
          weightedScore: response.weightedScore,
        })),
      );
    }

    for (const category of input.categoryBreakdown) {
      await tx
        .insert(knowledgeCategories)
        .values({
          sessionId: input.sessionId,
          name: category.name,
          questionCount: category.questionCount,
          correctCount: category.correctCount,
          avgRawScore: category.avgRawScore,
          weightedScore: category.weightedScore,
          strength: category.strength,
        })
        .onConflictDoUpdate({
          target: [knowledgeCategories.sessionId, knowledgeCategories.name],
          set: {
            questionCount: category.questionCount,
            correctCount: category.correctCount,
            avgRawScore: category.avgRawScore,
            weightedScore: category.weightedScore,
            strength: category.strength,
          },
        });
    }

    await tx.insert(insights).values({
      sessionId: input.sessionId,
      kind: 'gap_analysis',
      payload: input.insights,
      sources: null,
    });

    return { won: true };
  }

  public async getSubmittedResult(
    sessionId: string,
    userId: InternalUserId,
  ): Promise<SubmitResponseDto | null> {
    const tx = getRequestContext().tx;
    const sessionRows = await tx
      .select()
      .from(quizSessions)
      .where(and(eq(quizSessions.id, sessionId), eq(quizSessions.userId, userId)))
      .limit(1);
    const session = sessionRows[0];
    if (!session || session.status !== 'submitted') return null;

    const questionRows = await tx
      .select()
      .from(questions)
      .where(eq(questions.sessionId, sessionId))
      .orderBy(questions.position);
    const questionIds = questionRows.map((q) => q.id);
    const answerRows =
      questionIds.length > 0
        ? await tx.select().from(answers).where(inArray(answers.questionId, questionIds))
        : [];
    const responseRows = await tx
      .select()
      .from(userResponses)
      .where(eq(userResponses.sessionId, sessionId));
    const categoryRows = await tx
      .select()
      .from(knowledgeCategories)
      .where(eq(knowledgeCategories.sessionId, sessionId));
    const insightsRows = await tx
      .select()
      .from(insights)
      .where(and(eq(insights.sessionId, sessionId), eq(insights.kind, 'gap_analysis')))
      .orderBy(desc(insights.createdAt))
      .limit(1);
    const insightsRow = insightsRows[0];
    if (!insightsRow) return null;

    const answersByQuestion = new Map<string, typeof answerRows>();
    for (const answer of answerRows) {
      const bucket = answersByQuestion.get(answer.questionId) ?? [];
      bucket.push(answer);
      answersByQuestion.set(answer.questionId, bucket);
    }
    const responseByQuestion = new Map(responseRows.map((r) => [r.questionId, r]));

    const breakdown = questionRows.map((q) => {
      const response = responseByQuestion.get(q.id);
      if (!response) throw new Error(`missing user_responses row for question ${q.id}`);
      const correctAnswers = (answersByQuestion.get(q.id) ?? [])
        .filter((a) => a.isCorrect)
        .map((a) => a.position)
        .sort((a, b) => a - b);
      return QuestionResultSchema.parse({
        questionId: q.id,
        position: q.position,
        rawScore: response.rawScore,
        weight: response.weight,
        weightedScore: response.weightedScore,
        correctAnswers,
        selected: [...response.selected],
      });
    });

    const categoryBreakdown = categoryRows.map((c) =>
      CategoryPerformanceSchema.parse({
        name: c.name,
        questionCount: c.questionCount,
        correctCount: c.correctCount,
        avgRawScore: c.avgRawScore,
        weightedScore: c.weightedScore,
        strength: c.strength,
      }),
    );

    return Object.freeze(
      SubmitResponseSchema.parse({
        sessionId,
        finalScore: session.finalScore,
        actualCount: session.actualCount ?? undefined,
        breakdown,
        categoryBreakdown,
        insights: insightsRow.payload,
      }),
    );
  }
}
