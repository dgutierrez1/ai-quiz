import { createHash } from 'node:crypto';

import type { SessionQuestionRowDto } from '@ai-quiz/shared';
import { SessionQuestionRowSchema } from '@ai-quiz/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type {
  FailedSessionParams,
  PersistGeneratedQuizInput,
  QuizPersistencePort,
} from '../../../domain/ports/quiz-persistence.port.js';
import { getRequestContext } from '../../../driving/middleware/request-context.js';
import { DATABASE_TOKEN, type DatabaseState } from './client.js';
import { answers, documents, questions, quizSessions } from './schema.js';

/**
 * Adapter for Story 2.6's persist / failure-state / read-back steps.
 *
 * Two distinct transactional contracts live in this one class (see
 * `QuizPersistencePort`'s doc comment):
 *   - `persistGeneratedQuiz` / `forUserSessionQuestions` ride the caller's
 *     existing ALS-scoped request transaction (`getRequestContext().tx`) —
 *     same connection `identity.interceptor.ts` already opened and set
 *     `app.user_id` on.
 *   - `markSessionFailed` deliberately does NOT use that transaction. It
 *     checks out a fresh client from the pool, opens its own transaction,
 *     sets its own `app.user_id` GUC, and commits independently — so the
 *     failure row survives even though the request transaction is about to
 *     roll back once the use-case rethrows.
 *
 * IMPORTANT — there is deliberately NO separate 'pending' row inserted
 * anywhere before generation runs. Both `persistGeneratedQuiz` (ready) and
 * `markSessionFailed` (failed) are the FIRST and ONLY writer of the
 * `quiz_sessions` row for a given session id, each on its own connection.
 * An earlier design pre-inserted a 'pending' row via the request
 * transaction and had the failure path UPDATE/UPSERT it from a second
 * connection — that self-deadlocks: the fresh connection's write blocks on
 * the still-open request transaction's uncommitted row lock for that same
 * id, and that lock can only be released once THIS call returns, so it
 * blocks until `statement_timeout`/`lock_timeout` fires. Never reintroduce
 * a pre-insert here.
 */
@Injectable()
export class QuizPersistenceRepository implements QuizPersistencePort {
  public constructor(@Inject(DATABASE_TOKEN) private readonly state: DatabaseState) {}

  public async persistGeneratedQuiz(input: PersistGeneratedQuizInput): Promise<void> {
    const tx = getRequestContext().tx;
    const contentHash = createHash('sha256').update(input.contentMarkdown, 'utf8').digest('hex');

    // Insert the session row FIRST (status='ready', single INSERT — no
    // pre-existing 'pending' row to update, see class doc comment) so the
    // child tables' RLS policies (EXISTS-join back to quiz_sessions) find a
    // matching parent row already visible within this same transaction.
    await tx.insert(quizSessions).values({
      id: input.sessionId,
      userId: input.userId,
      sourceUrl: input.sourceUrl,
      topic: input.topic ?? null,
      strategy: input.strategy,
      provider: input.provider,
      model: input.model,
      status: 'ready',
      questionCount: input.questionCount,
      actualCount: input.actualCount,
      selectedCategories: [...input.selectedCategories],
    });

    await tx.insert(documents).values({
      sessionId: input.sessionId,
      sourceUrl: input.sourceUrl,
      contentMarkdown: input.contentMarkdown,
      chunks: [...input.chunks],
      contentHash,
      byteSize: input.byteSize,
      tokenEstimate: input.tokenEstimate,
    });

    for (let i = 0; i < input.questions.length; i += 1) {
      const question = input.questions[i]!;
      const [inserted] = await tx
        .insert(questions)
        .values({
          sessionId: input.sessionId,
          position: i,
          text: question.text,
          type: question.type,
          category: question.category,
          explanation: question.explanation,
        })
        .returning();
      if (!inserted) throw new Error('failed to insert question');
      for (const answer of question.answers) {
        await tx.insert(answers).values({
          questionId: inserted.id,
          position: answer.position,
          text: answer.text,
          isCorrect: answer.isCorrect,
        });
      }
    }

    // NOTE (AD-16): `knowledge_categories` is intentionally never written
    // here — `SubmitAnswersUseCase` (Epic 3) is its sole writer.
  }

  public async markSessionFailed(sessionId: string, params: FailedSessionParams): Promise<void> {
    const client = await this.state.pool.connect();
    try {
      await client.query('BEGIN');
      // `lock_timeout` bounds the ONE remaining real contention point: a
      // brand-new caller whose `users` row was upserted by THIS SAME
      // request's `identity.interceptor.ts` transaction, which is also
      // still open (about to roll back) at the moment this runs. Without a
      // short timeout, our own `INSERT ... ON CONFLICT` on `users` would
      // block for the full `statement_timeout` (10s) waiting on a lock that
      // can only be released once this call returns.
      await client.query(`SET LOCAL lock_timeout = '500ms'`);
      await client.query('SAVEPOINT before_user_upsert');
      let internalUserId: string | undefined;
      try {
        const userResult = await client.query<{ id: string }>(
          `INSERT INTO users (external_id) VALUES ($1)
           ON CONFLICT (external_id) DO UPDATE SET external_id = EXCLUDED.external_id
           RETURNING id`,
          [params.externalUserId],
        );
        internalUserId = userResult.rows[0]?.id;
      } catch {
        // Lock contention against the still-open request transaction's own
        // (guaranteed-to-roll-back) upsert for this same external id. Fall
        // back to a plain, non-blocking read — under MVCC a plain SELECT
        // never waits on another transaction's uncommitted row lock, it
        // simply doesn't see the uncommitted row yet. This resolves the
        // common case: a returning user whose row already committed on an
        // earlier, unrelated request.
        await client.query('ROLLBACK TO SAVEPOINT before_user_upsert');
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE external_id = $1`,
          [params.externalUserId],
        );
        internalUserId = existing.rows[0]?.id;
      }
      if (!internalUserId) {
        // First-ever request for this external id, failing before its own
        // user-row commit — cannot safely persist a durable failure row
        // without risking the same self-deadlock. Best-effort: the caller
        // still sees the primary error; a retry succeeds once the user
        // exists (their `X-User-Id` upsert commits on any successful
        // request, including a retry of this same one).
        await client.query('ROLLBACK');
        return;
      }
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [internalUserId]);
      // A single INSERT — `sessionId` was never written by any other
      // transaction (see class doc comment), so this never contends.
      // ON CONFLICT is defensive only (idempotent retry of this same call).
      await client.query(
        `INSERT INTO quiz_sessions
           (id, user_id, source_url, topic, strategy, provider, model, status, error_message, question_count, actual_count, selected_categories)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'failed',$8,$9,NULL,'[]'::jsonb)
         ON CONFLICT (id) DO UPDATE SET status = 'failed', error_message = EXCLUDED.error_message`,
        [
          sessionId,
          internalUserId,
          params.sourceUrl,
          params.topic ?? null,
          params.strategy,
          params.provider,
          params.model,
          params.errorMessage,
          params.questionCount,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // Best effort — the connection is being released regardless.
      });
      throw error;
    } finally {
      client.release();
    }
  }

  public async forUserSessionQuestions(
    sessionId: string,
  ): Promise<readonly SessionQuestionRowDto[]> {
    const tx = getRequestContext().tx;
    const questionRows = await tx
      .select()
      .from(questions)
      .where(eq(questions.sessionId, sessionId))
      .orderBy(questions.position);
    const result: SessionQuestionRowDto[] = [];
    for (const question of questionRows) {
      const answerRows = await tx
        .select()
        .from(answers)
        .where(eq(answers.questionId, question.id))
        .orderBy(answers.position);
      result.push(
        SessionQuestionRowSchema.parse({
          id: question.id,
          sessionId: question.sessionId,
          position: question.position,
          text: question.text,
          type: question.type,
          category: question.category,
          explanation: question.explanation,
          answers: answerRows.map((answer) => ({
            position: answer.position,
            text: answer.text,
            isCorrect: answer.isCorrect,
          })),
        }),
      );
    }
    return Object.freeze(result);
  }
}
