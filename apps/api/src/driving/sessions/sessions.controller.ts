import { randomUUID } from 'node:crypto';

import type { CreateSessionRequest, SessionQuestionRowDto } from '@ai-quiz/shared';
import { CreateSessionRequestSchema, SessionQuestionWireSchema } from '@ai-quiz/shared';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';

import { hashUserId } from '../../adapters/observability/observability.module.js';
import { QuizPersistenceRepository } from '../../adapters/persistence/drizzle/quiz-persistence.repository.js';
import { QuizSessionRepository } from '../../adapters/persistence/drizzle/quiz-session.repository.js';
import { SubmissionRepository } from '../../adapters/persistence/drizzle/submission.repository.js';
import { ENRICHMENT_PORT, type EnrichmentPort } from '../../domain/ports/enrichment.port.js';
import { INGESTION_PORT, type IngestionPort } from '../../domain/ports/ingestion.port.js';
import { LLM_PORT, type LlmPort } from '../../domain/ports/llm.port.js';
import { TRACING_PORT, type TracingPort } from '../../domain/ports/tracing.port.js';
import {
  SessionGenerationResponseSchema,
  SessionResultResponseSchema,
} from '../../domain/quiz/dto/session-response.dto.js';
import { NotFoundError } from '../../domain/quiz/errors/not-found.error.js';
import { generateQuiz } from '../../domain/quiz/use-cases/generate-quiz.js';
import { IdentityInterceptor } from '../middleware/identity.interceptor.js';
import { OwnsSession } from '../middleware/own-session.interceptor.js';
import { getRequestContext } from '../middleware/request-context.js';
import { ThrottleCreateSession } from '../middleware/throttler.config.js';
import {
  type ListSessionsQueryDto,
  ListSessionsQuerySchema,
  SessionsListResponseSchema,
} from './dto/sessions-list.schemas.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

function toWireQuestions(rows: readonly SessionQuestionRowDto[]) {
  return rows.map((row) => SessionQuestionWireSchema.parse(row));
}

@Controller('sessions')
@UseInterceptors(IdentityInterceptor)
export class SessionsController {
  public constructor(
    private readonly sessions: QuizSessionRepository,
    private readonly persistence: QuizPersistenceRepository,
    private readonly submissions: SubmissionRepository,
    @Inject(TRACING_PORT) private readonly tracing: TracingPort,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(INGESTION_PORT) private readonly ingestion: IngestionPort,
    @Inject(ENRICHMENT_PORT) private readonly enrichment: EnrichmentPort,
  ) {}

  @Post()
  @ThrottleCreateSession()
  public async create(
    @Body(new ZodValidationPipe(CreateSessionRequestSchema)) input: CreateSessionRequest,
    @Headers('x-user-id') externalUserId: string,
  ) {
    const userId = getRequestContext().userId;
    const id = randomUUID();

    // Synchronous critical path (Stories 2.4-2.6): fetch -> neutralize/chunk
    // -> guard -> select chunk budget -> 1 structured LLM call -> validate
    // -> classify shortfall -> category feasibility search -> stratified
    // draw -> persist. There is deliberately NO 'pending' row inserted
    // before this call (see quiz-persistence.repository.ts's class doc
    // comment for why a pre-insert would self-deadlock the failure path).
    // On success, `persistGeneratedQuiz` inserts the 'ready' row itself,
    // inside this same request transaction. On failure, `generateQuiz`
    // durably persists a 'failed' row on its OWN, separately-committed
    // transaction (AD-9) BEFORE rethrowing — this request's transaction
    // (which holds nothing else) then rolls back harmlessly.
    const result = await generateQuiz(
      {
        sessionId: id,
        userId,
        externalUserId,
        sourceUrl: input.sourceUrl,
        topic: input.topic,
        strategy: input.strategy,
        questionCount: input.questionCount,
        provider: input.provider,
        model: input.model,
      },
      {
        ingestion: this.ingestion,
        llm: this.llm,
        persistence: this.persistence,
        enrichment: this.enrichment,
        // NFR-3 / SM-5: every LLM call on the generation path emits a trace.
        // `userIdHash` (not the raw users.id) is what reaches the tracer.
        tracing: this.tracing,
        userIdHash: hashUserId(userId),
      },
    );

    const questions = await this.persistence.forUserSessionQuestions(id);
    return Object.freeze(
      SessionGenerationResponseSchema.parse({
        id,
        status: 'ready',
        questionCount: input.questionCount,
        actualCount: result.actualCount ?? undefined,
        selectedCategories: result.selectedCategories,
        questions: toWireQuestions(questions),
      }),
    );
  }

  // Story 5.1 — GET /api/sessions (list, no :id). Structurally distinct path
  // from GET /api/sessions/:id below, so there is no NestJS route-ordering
  // conflict. No @OwnsSession() here (AC #7) — that decorator reads
  // `request.params.id`, which doesn't exist on this route; scoping comes
  // entirely from the repository's `WHERE user_id = ?` filter (AD-9), backed
  // by Postgres RLS as the database-layer half.
  @Get()
  public async list(
    @Query(new ZodValidationPipe(ListSessionsQuerySchema)) query: ListSessionsQueryDto,
  ) {
    const userId = getRequestContext().userId;
    const before = query.before ? new Date(query.before) : undefined;
    const { rows, hasMore } = await this.sessions.listForUser(userId, {
      limit: query.limit,
      before,
    });
    return Object.freeze(
      SessionsListResponseSchema.parse({
        sessions: rows.map((row) => ({
          id: row.id,
          sourceUrl: row.sourceUrl,
          status: row.status,
          createdAt: row.createdAt,
        })),
        hasMore,
      }),
    );
  }

  @Get(':id')
  @OwnsSession()
  public async get(@Param('id') id: string) {
    const userId = getRequestContext().userId;
    const session = await this.sessions.findByIdAndUserId(id, userId);
    if (!session) throw new NotFoundError(); // defensive — @OwnsSession() already guards this

    // Submitted sessions merge Story 3.1's persisted results (finalScore,
    // breakdown, categoryBreakdown, insights) with the full question/answer
    // set (isCorrect revealed post-submit) — reusing the submit read model
    // rather than re-scoring or re-deriving insights here.
    if (session.status === 'submitted') {
      const [result, questionRows] = await Promise.all([
        this.submissions.getSubmittedResult(id, userId),
        this.submissions.findQuestionsWithAnswersForUser(id, userId),
      ]);
      if (!result || !questionRows) throw new NotFoundError();
      return Object.freeze(
        SessionResultResponseSchema.parse({
          id: session.id,
          status: 'submitted',
          questionCount: session.questionCount,
          actualCount: result.actualCount ?? session.actualCount ?? undefined,
          selectedCategories: session.selectedCategories,
          questions: questionRows,
          finalScore: result.finalScore,
          breakdown: result.breakdown,
          categoryBreakdown: result.categoryBreakdown,
          insights: result.insights,
        }),
      );
    }

    // `ready` -> full questions, isCorrect stripped by SessionQuestionWireSchema
    // (security boundary — never leak the answer key pre-submit).
    // `pending` / `failed` -> no questions, status + errorMessage only.
    const questions =
      session.status === 'ready' ? await this.persistence.forUserSessionQuestions(id) : [];
    return Object.freeze(
      SessionGenerationResponseSchema.parse({
        id: session.id,
        status: session.status,
        questionCount: session.questionCount,
        actualCount: session.actualCount ?? undefined,
        selectedCategories: session.selectedCategories,
        questions: toWireQuestions(questions),
        errorMessage: session.errorMessage ?? undefined,
      }),
    );
  }
}
