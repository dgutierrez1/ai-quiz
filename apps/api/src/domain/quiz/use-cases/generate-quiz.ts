import type {
  GeneratedQuestionDto,
  QuizSessionProvider,
  QuizSessionStrategy,
} from '@ai-quiz/shared';

import type { EnrichmentPort } from '../../ports/enrichment.port.js';
import type { IngestionPort } from '../../ports/ingestion.port.js';
import type { LlmPort } from '../../ports/llm.port.js';
import type {
  FailedSessionParams,
  QuizPersistencePort,
} from '../../ports/quiz-persistence.port.js';
import type { TracingPort } from '../../ports/tracing.port.js';
import { CategorySelectionInfeasibleError } from '../errors/category-selection-infeasible.error.js';
import { UntrustedLlmOutputError } from '../errors/generation.errors.js';
import { selectCategoriesAndDraw } from '../services/category-selection.service.js';
import { chunkDocument } from '../services/chunker.js';
import { classifyShortfall } from '../services/classify-pool-shortfall.js';
import { prepareDocumentForGeneration } from '../services/document-preparation.js';
import { hasNovelSecret, isGrounded } from '../services/pool-validation.js';
import { selectChunkBudget } from '../services/select-chunk-budget.js';

export interface GenerateQuizInput {
  readonly sessionId: string;
  readonly userId: string;
  /**
   * The raw `X-User-Id` header value. The failure-write path (AD-9) opens a
   * FRESH connection whose transaction is independent of — and, on the
   * failure path, always OLDER than the commit of — the request
   * transaction's own `users` upsert (`identity.interceptor.ts`). If that
   * request transaction never commits (which is exactly what happens here:
   * we are about to throw), the internal `userId` above may reference a
   * `users` row that does not durably exist yet, and a failure INSERT
   * against `quiz_sessions.user_id` would violate the FK. Carrying the
   * external id lets the failure-write path independently re-upsert `users`
   * inside ITS OWN transaction first, so the FK always resolves.
   */
  readonly externalUserId: string;
  readonly sourceUrl: string;
  readonly topic?: string;
  readonly strategy: QuizSessionStrategy;
  readonly questionCount: number;
  readonly provider: QuizSessionProvider;
  readonly model: string;
}

export interface GenerateQuizOutput {
  /** Array order IS position order (0..actualCount-1). */
  readonly questions: readonly GeneratedQuestionDto[];
  /** Non-null only when < the originally-requested questionCount. */
  readonly actualCount: number | null;
  readonly selectedCategories: readonly string[];
}

export interface GenerateQuizDeps {
  readonly ingestion: IngestionPort;
  readonly llm: LlmPort;
  readonly persistence: QuizPersistencePort;
  readonly enrichment?: EnrichmentPort;
  /** Model context window in tokens — used only by the doc-size guard. */
  readonly contextWindowTokens?: number;
  readonly chunkTokenBudget?: number;
  readonly categorySelectionFloor?: number;
  readonly rng?: () => number;
  /**
   * NFR-3 / SM-5. Optional so unit tests can omit it; when absent no trace is
   * emitted. Tracing is an optimization, never a correctness dependency, so a
   * failure here must never affect the generated quiz.
   */
  readonly tracing?: TracingPort;
  /** SHA-256 of the internal users.id. Never the raw id (constitution rule 9). */
  readonly userIdHash?: string;
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 64_000;
const DEFAULT_CHUNK_TOKEN_BUDGET = 8_000;
const DEFAULT_CATEGORY_FLOOR = 5;
/** See `scheduleFailureWrite`'s doc comment — must run after the request transaction's rollback releases its locks. */
const FAILURE_WRITE_DELAY_MS = 50;

/** AD-4/AD-6 — total LLM calls hard-capped by provider mode: 2 (strict — minimax) / 3 (best-effort — openrouter). */
function retryBudgetFor(provider: QuizSessionProvider): number {
  return provider === 'minimax' ? 2 : 3;
}

/**
 * Emit one Langfuse generation trace per LLM attempt (NFR-3, SM-5).
 *
 * Swallows everything: the port's own contract says it must not throw, and this
 * is belt-and-braces so that a tracing bug can never turn a good quiz into a
 * failed request. Callers invoke it with `void` for the same reason — the trace
 * must never sit on the user's critical path.
 */
async function recordTrace(
  deps: GenerateQuizDeps,
  input: GenerateQuizInput,
  detail: { latencyMs: number; prompt: string; output?: string; error?: string },
): Promise<void> {
  if (!deps.tracing) return;
  try {
    await deps.tracing.recordGeneration({
      name: 'generate-quiz',
      provider: input.provider,
      model: input.model,
      input: detail.prompt,
      output: detail.output,
      latencyMs: detail.latencyMs,
      sessionId: input.sessionId,
      userIdHash: deps.userIdHash,
      error: detail.error,
    });
  } catch {
    // Deliberately ignored — see the doc comment.
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown generation error';
}

/**
 * Canonical v1 generation pipeline (Stories 2.4 + 2.5 + 2.6), the sync half
 * of `POST /api/sessions`:
 *   fetch -> neutralize/chunk/guard -> select chunk budget -> 1 structured
 *   LLM call (with a whole-pool regenerate retry budget) -> validate
 *   (grounding + secret-token) -> classify shortfall -> category
 *   feasibility search -> stratified draw -> persist -> return.
 *
 * On ANY failure, `status='failed'` is durably persisted on its own,
 * separately-committed transaction (AD-9) so the request transaction's
 * rollback never erases the visible failure state. That write is
 * deliberately SCHEDULED, not awaited, before this function rethrows — see
 * `scheduleFailureWrite`'s doc comment for why an awaited write here would
 * self-deadlock against the still-open request transaction.
 */
export async function generateQuiz(
  input: GenerateQuizInput,
  deps: GenerateQuizDeps,
): Promise<GenerateQuizOutput> {
  try {
    const document = await deps.ingestion.fetchMarkdown(input.sourceUrl);
    const prepared = prepareDocumentForGeneration(document.content, {
      questionCount: input.questionCount,
      contextWindowTokens: deps.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    });
    // Deterministic given (chunks, budget) — computed once, reused
    // unchanged across every retry attempt (AD-N4: determinism is scoped to
    // chunk selection, not model sampling).
    const chunkBudget = selectChunkBudget(
      chunkDocument(prepared.neutralizedText),
      deps.chunkTokenBudget ?? DEFAULT_CHUNK_TOKEN_BUDGET,
    );
    const poolSize = Math.ceil(input.questionCount * 1.5);
    const totalAttempts = retryBudgetFor(input.provider);

    let validPool: GeneratedQuestionDto[] = [];
    let requestedQ = input.questionCount;
    let succeeded = false;
    let lastFailureReason = 'the model never returned a usable question pool';

    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      const prompt = JSON.stringify({
        topic: input.topic,
        strategy: input.strategy,
        chunks: chunkBudget,
      });
      const startedAt = Date.now();
      let pool;
      try {
        pool = await deps.llm.generateQuiz({
          provider: input.provider,
          model: input.model,
          prompt,
          poolSize,
          allowFallback: false, // AD-6 — provider fallback is disabled on the generation path
        });
      } catch (error) {
        // Trace the failed attempt too — an attempt that never returned is
        // exactly the case worth seeing in Langfuse — then let the existing
        // retry/throw semantics take over unchanged.
        void recordTrace(deps, input, {
          latencyMs: Date.now() - startedAt,
          prompt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      void recordTrace(deps, input, {
        latencyMs: Date.now() - startedAt,
        prompt,
        output: JSON.stringify(pool),
      });
      const candidates = pool.questions.filter(
        (question) =>
          isGrounded(question, chunkBudget) && !hasNovelSecret(question, prepared.neutralizedText),
      );
      const distinctCategories = new Set(candidates.map((question) => question.category)).size;
      const classification = classifyShortfall(
        candidates.length,
        distinctCategories,
        input.questionCount,
      );

      if (classification.outcome === 'regenerate') {
        lastFailureReason = `only ${candidates.length} valid question(s) across ${distinctCategories} categor${distinctCategories === 1 ? 'y' : 'ies'} survived validation`;
        continue;
      }
      validPool = candidates;
      requestedQ = classification.q;
      succeeded = true;
      break;
    }

    if (!succeeded) {
      throw new UntrustedLlmOutputError(lastFailureReason);
    }

    const selection = selectCategoriesAndDraw(validPool, requestedQ, {
      floor: deps.categorySelectionFloor ?? DEFAULT_CATEGORY_FLOOR,
      rng: deps.rng,
    });
    if (!selection.ok) {
      throw new CategorySelectionInfeasibleError();
    }

    const actualCount = selection.actualCount < input.questionCount ? selection.actualCount : null;

    await deps.persistence.persistGeneratedQuiz({
      sessionId: input.sessionId,
      userId: input.userId,
      sourceUrl: document.url,
      topic: input.topic ?? null,
      strategy: input.strategy,
      provider: input.provider,
      model: input.model,
      questionCount: input.questionCount,
      contentMarkdown: prepared.neutralizedText,
      chunks: prepared.chunks,
      tokenEstimate: prepared.estimatedTokens,
      byteSize: Buffer.byteLength(document.content, 'utf8'),
      questions: selection.drawnQuestions,
      selectedCategories: selection.selectedCategories,
      actualCount,
    });

    // Async enrichment: fire-and-forget, never a correctness dependency.
    // Its result (if any) is discarded — the response below is built only
    // from the already-persisted `selection.drawnQuestions`.
    if (deps.enrichment) {
      void deps.enrichment
        .enrich({ questions: selection.drawnQuestions, topic: input.topic })
        .catch(() => {
          // Swallowed by design — enrichment must never surface an error to
          // the caller or affect the response already returned.
        });
    }

    return {
      questions: selection.drawnQuestions,
      actualCount,
      selectedCategories: selection.selectedCategories,
    };
  } catch (error) {
    // Only a genuine GENERATION failure earns a durable `status='failed'` row.
    //
    // The pre-LLM guards (SSRF rejection, doc too large/short, ingest timeout)
    // are 400-class rejections of the REQUEST — nothing was ever generated, so
    // writing a failed session for them pollutes the user's history with a row
    // per typo'd URL or short document, and contradicts the rule that `failed`
    // is reachable only via the untrusted-output path. The 400 + hint is
    // already the complete, actionable answer.
    if (isGenerationFailure(error)) {
      scheduleFailureWrite(deps.persistence, input, describeError(error));
    }
    throw error;
  }
}

/**
 * True only for failures that occurred AFTER the pipeline committed to
 * generating — i.e. the model was called (or the validated pool could not be
 * drawn from). Everything else is input validation.
 */
function isGenerationFailure(error: unknown): boolean {
  return (
    error instanceof UntrustedLlmOutputError || error instanceof CategorySelectionInfeasibleError
  );
}

/**
 * Schedules the durable `status='failed'` write WITHOUT awaiting it here —
 * this is deliberate, not an oversight. This function's caller is running
 * INSIDE the request transaction `identity.interceptor.ts` opened for this
 * exact request; that transaction is about to roll back once we rethrow
 * below. `markSessionFailed` opens a second, independent connection and
 * writes the SAME user's `quiz_sessions`/`users` rows — but Postgres row
 * locks are held for the LIFETIME of a transaction, not just a statement, so
 * as long as the request transaction remains open, any conflicting lock
 * request from that second connection blocks. It can only succeed once the
 * request transaction has actually rolled back and released its locks —
 * which cannot happen until control returns to `identity.interceptor.ts`,
 * i.e. AFTER this function returns. Awaiting the write here would therefore
 * deadlock (bounded only by `markSessionFailed`'s own `lock_timeout`).
 * Scheduling it on a later tick guarantees it runs after the rollback has
 * completed. This mirrors the same accepted trade-off already used for
 * `enrich()`: fire-and-forget, best-effort, never a correctness dependency
 * for the response already sent (the caller never learns this session id on
 * the failure path anyway — see `SessionGenerationResponseSchema`'s use at
 * the controller, which never returns an id for a thrown error).
 */
function scheduleFailureWrite(
  persistence: QuizPersistencePort,
  input: GenerateQuizInput,
  errorMessage: string,
): void {
  const params: FailedSessionParams = {
    externalUserId: input.externalUserId,
    sourceUrl: input.sourceUrl,
    topic: input.topic ?? null,
    strategy: input.strategy,
    provider: input.provider,
    model: input.model,
    questionCount: input.questionCount,
    errorMessage,
  };
  setTimeout(() => {
    void persistence.markSessionFailed(input.sessionId, params).catch(() => {
      // Best-effort — see the doc comment above. Nothing left to surface
      // this to; the primary request/response cycle has already completed.
    });
  }, FAILURE_WRITE_DELAY_MS);
}
