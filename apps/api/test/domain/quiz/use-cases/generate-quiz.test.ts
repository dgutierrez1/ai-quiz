import type { GeneratedQuestionDto, IngestedDocumentDto, QuestionPoolDto } from '@ai-quiz/shared';
import { describe, expect, it, vi } from 'vitest';

import type { EnrichmentPort } from '../../../../src/domain/ports/enrichment.port.js';
import type { IngestionPort } from '../../../../src/domain/ports/ingestion.port.js';
import type { GenerateQuizParams, LlmPort } from '../../../../src/domain/ports/llm.port.js';
import type {
  FailedSessionParams,
  PersistGeneratedQuizInput,
  QuizPersistencePort,
} from '../../../../src/domain/ports/quiz-persistence.port.js';
import { CategorySelectionInfeasibleError } from '../../../../src/domain/quiz/errors/category-selection-infeasible.error.js';
import { UntrustedLlmOutputError } from '../../../../src/domain/quiz/errors/generation.errors.js';
import type { GenerateQuizInput } from '../../../../src/domain/quiz/use-cases/generate-quiz.js';
import { generateQuiz } from '../../../../src/domain/quiz/use-cases/generate-quiz.js';

const WORD_POOL =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango'.split(
    ' ',
  );

function buildDocContent(): string {
  const paragraph = `${WORD_POOL.join(' ')}. `;
  // Sized to clear the 500-tokens/question density floor at questionCount=8
  // while staying a single chunk comfortably under the 8000-token chunk
  // budget (no headings here, so chunkDocument returns it as one chunk).
  return `# Doc\n\n${paragraph.repeat(150)}`;
}

function fakeIngestion(): IngestionPort {
  return {
    fetchMarkdown: vi.fn(async (url: string): Promise<Readonly<IngestedDocumentDto>> => ({
      url,
      content: buildDocContent(),
      contentType: 'text/markdown',
      byteSize: Buffer.byteLength(buildDocContent(), 'utf8'),
    })),
  };
}

function makeQuestion(
  category: string,
  seed: number,
  groundedWord = WORD_POOL[seed % WORD_POOL.length],
): GeneratedQuestionDto {
  return {
    text: `What is true about ${groundedWord} number ${seed}?`,
    type: 'single',
    category,
    explanation: `${groundedWord} explanation`,
    answers: [
      { position: 0, text: `${groundedWord} answer A`, isCorrect: true },
      { position: 1, text: 'unrelated answer B', isCorrect: false },
      { position: 2, text: 'unrelated answer C', isCorrect: false },
      { position: 3, text: 'unrelated answer D', isCorrect: false },
    ],
  };
}

function makePool(
  count: number,
  categories: readonly string[] = ['core', 'detail'],
): QuestionPoolDto {
  const questions: GeneratedQuestionDto[] = [];
  for (let i = 0; i < count; i += 1) {
    questions.push(makeQuestion(categories[i % categories.length]!, i));
  }
  return Object.freeze({ questions });
}

function ungroundedPool(count: number): QuestionPoolDto {
  const questions: GeneratedQuestionDto[] = [];
  for (let i = 0; i < count; i += 1) {
    questions.push({
      text: `zzzznotgrounded${i} zzzzneverinthesource${i}`,
      type: 'single',
      category: i % 2 === 0 ? 'core' : 'detail',
      explanation: 'zzzz',
      answers: [
        { position: 0, text: 'zzzz', isCorrect: true },
        { position: 1, text: 'zzzz2', isCorrect: false },
        { position: 2, text: 'zzzz3', isCorrect: false },
        { position: 3, text: 'zzzz4', isCorrect: false },
      ],
    });
  }
  return Object.freeze({ questions });
}

function fakePersistence(): QuizPersistencePort & {
  readonly persistCalls: PersistGeneratedQuizInput[];
  readonly failCalls: Array<{ sessionId: string; params: FailedSessionParams }>;
} {
  const persistCalls: PersistGeneratedQuizInput[] = [];
  const failCalls: Array<{ sessionId: string; params: FailedSessionParams }> = [];
  return {
    persistCalls,
    failCalls,
    async persistGeneratedQuiz(input) {
      persistCalls.push(input);
    },
    async markSessionFailed(sessionId, params) {
      failCalls.push({ sessionId, params });
    },
    async forUserSessionQuestions() {
      return [];
    },
  };
}

/** The failure-write is intentionally scheduled (not awaited) past the
 * request's own transaction — see generate-quiz.ts's `scheduleFailureWrite`
 * doc comment. Tests that assert on `persistence.failCalls` after a
 * rejection must let that scheduled tick run first. */
async function flushScheduledFailureWrite(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

function baseInput(overrides: Partial<GenerateQuizInput> = {}): GenerateQuizInput {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    externalUserId: '11111111-1111-4111-8111-111111111111',
    sourceUrl: 'https://example.com/doc.md',
    strategy: 'mixed',
    questionCount: 8,
    provider: 'minimax',
    model: 'MiniMax-M3',
    ...overrides,
  };
}

describe('generateQuiz use-case', () => {
  it('(a) full pool on the first attempt -> full outcome, actualCount null, questions persisted', async () => {
    const llmGenerateQuiz = vi.fn(async (): Promise<Readonly<QuestionPoolDto>> => makePool(12));
    const llm: LlmPort = {
      generateQuiz: llmGenerateQuiz,
      chat: vi.fn(),
    } as unknown as LlmPort;
    const persistence = fakePersistence();

    const result = await generateQuiz(baseInput(), {
      ingestion: fakeIngestion(),
      llm,
      persistence,
    });

    expect(result.questions.length).toBe(8);
    expect(result.actualCount).toBeNull();
    expect(llmGenerateQuiz).toHaveBeenCalledTimes(1);
    expect(persistence.persistCalls).toHaveLength(1);
    expect(persistence.persistCalls[0]!.actualCount).toBeNull();
    expect(persistence.failCalls).toHaveLength(0);
  });

  it('(b) shortfall pool (5 <= V < questionCount) -> outcome carries q === V as actualCount', async () => {
    // 6 valid questions across 2 categories, requested 8.
    const llm: LlmPort = {
      generateQuiz: vi.fn(async () => makePool(6)),
      chat: vi.fn(),
    } as unknown as LlmPort;
    const persistence = fakePersistence();

    const result = await generateQuiz(baseInput(), {
      ingestion: fakeIngestion(),
      llm,
      persistence,
    });

    expect(result.actualCount).toBe(6);
    expect(result.questions.length).toBe(6);
    expect(persistence.persistCalls[0]!.actualCount).toBe(6);
  });

  it('(c) V < 5 on every attempt through exhaustion -> throws UntrustedLlmOutputError, call count == retry budget', async () => {
    const llmGenerateQuiz = vi.fn(async () => ungroundedPool(12)); // every question fails grounding -> V=0 every time
    const llm: LlmPort = {
      generateQuiz: llmGenerateQuiz,
      chat: vi.fn(),
    } as unknown as LlmPort;
    const persistence = fakePersistence();

    await expect(
      generateQuiz(baseInput({ provider: 'minimax' }), {
        ingestion: fakeIngestion(),
        llm,
        persistence,
      }),
    ).rejects.toBeInstanceOf(UntrustedLlmOutputError);
    expect(llmGenerateQuiz).toHaveBeenCalledTimes(2); // strict-mode (minimax) budget = 2
    await flushScheduledFailureWrite();
    expect(persistence.failCalls).toHaveLength(1); // failure state durably scheduled before rethrow
    expect(persistence.persistCalls).toHaveLength(0); // never persisted a partial/padded quiz
  });

  it('(c-2) best-effort provider (openrouter) gets a 3-call retry budget', async () => {
    const llmGenerateQuiz = vi.fn(async () => ungroundedPool(12));
    const llm: LlmPort = {
      generateQuiz: llmGenerateQuiz,
      chat: vi.fn(),
    } as unknown as LlmPort;
    const persistence = fakePersistence();

    await expect(
      generateQuiz(
        baseInput({ provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' }),
        {
          ingestion: fakeIngestion(),
          llm,
          persistence,
        },
      ),
    ).rejects.toBeInstanceOf(UntrustedLlmOutputError);
    expect(llmGenerateQuiz).toHaveBeenCalledTimes(3);
  });

  it('(d) a pool question failing isGrounded/hasNovelSecret is excluded before classification', async () => {
    // Mix: 6 grounded + 6 ungrounded in one pool of 12. Only the 6 grounded
    // ones should count toward the shortfall classification.
    const grounded = makePool(6).questions;
    const ungrounded = ungroundedPool(6).questions;
    const mixed = Object.freeze({ questions: [...grounded, ...ungrounded] });
    const llm: LlmPort = {
      generateQuiz: vi.fn(async () => mixed),
      chat: vi.fn(),
    } as unknown as LlmPort;
    const persistence = fakePersistence();

    const result = await generateQuiz(baseInput(), {
      ingestion: fakeIngestion(),
      llm,
      persistence,
    });
    expect(result.actualCount).toBe(6); // shortfall: only the 6 grounded ones survived
  });

  it('regenerates the whole pool on a shortfall-triggering attempt, then succeeds on the next', async () => {
    const llmGenerateQuiz = vi
      .fn()
      .mockResolvedValueOnce(ungroundedPool(12)) // attempt 1: V=0 -> regenerate
      .mockResolvedValueOnce(makePool(12)); // attempt 2: full pool
    const llm: LlmPort = {
      generateQuiz: llmGenerateQuiz,
      chat: vi.fn(),
    } as unknown as LlmPort;
    const persistence = fakePersistence();

    const result = await generateQuiz(baseInput({ provider: 'openrouter', model: 'x' }), {
      ingestion: fakeIngestion(),
      llm,
      persistence,
    });

    expect(llmGenerateQuiz).toHaveBeenCalledTimes(2);
    expect(result.questions.length).toBe(8);
    expect(persistence.failCalls).toHaveLength(0);
  });

  it('category selection infeasibility -> CategorySelectionInfeasibleError, failure state persisted (Story 2.5 AC #5 — second, independent path to failed)', async () => {
    // 5 valid, 2-category pool (4 'core' + 1 'detail') clears the shortfall
    // ladder (V=5 >= 5, 2 categories >= 2 -> 'shortfall', q=5) but the ONLY
    // possible C at Q=5 with m=2 is C=2, which needs k=floor(5/2)=2 from
    // BOTH categories — 'detail' only has 1. The floor is already 5, so the
    // Q-decrement loop has nowhere left to go: infeasible.
    const questions: GeneratedQuestionDto[] = [
      makeQuestion('core', 0),
      makeQuestion('core', 1),
      makeQuestion('core', 2),
      makeQuestion('core', 3),
      makeQuestion('detail', 4),
    ];
    const pool: QuestionPoolDto = Object.freeze({ questions });
    const llm: LlmPort = {
      generateQuiz: vi.fn(async () => pool),
      chat: vi.fn(),
    } as unknown as LlmPort;
    const persistence = fakePersistence();

    await expect(
      generateQuiz(baseInput({ questionCount: 8 }), {
        ingestion: fakeIngestion(),
        llm,
        persistence,
      }),
    ).rejects.toBeInstanceOf(CategorySelectionInfeasibleError);
    await flushScheduledFailureWrite();
    expect(persistence.failCalls).toHaveLength(1);
    expect(persistence.persistCalls).toHaveLength(0);
  });

  it('enrichment is fire-and-forget: a rejecting enrichment never surfaces to the caller and never blocks the response', async () => {
    const llm: LlmPort = {
      generateQuiz: vi.fn(async () => makePool(12)),
      chat: vi.fn(),
    } as unknown as LlmPort;
    const persistence = fakePersistence();
    const enrichment: EnrichmentPort = {
      enrich: vi.fn(async () => {
        throw new Error('enrichment blew up');
      }),
    };

    const result = await generateQuiz(baseInput(), {
      ingestion: fakeIngestion(),
      llm,
      persistence,
      enrichment,
    });
    expect(result.questions.length).toBe(8);
    // Give the fire-and-forget rejection a tick to settle without throwing an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('CategorySelectionInfeasibleError is exported and instanceof Error (sanity)', () => {
    expect(new CategorySelectionInfeasibleError()).toBeInstanceOf(Error);
  });

  it('disables provider fallback on every LLM call (AD-6)', async () => {
    const llmGenerateQuiz = vi.fn(async (params: GenerateQuizParams) => {
      expect(params.allowFallback).toBe(false);
      return makePool(12);
    });
    const llm: LlmPort = {
      generateQuiz: llmGenerateQuiz,
      chat: vi.fn(),
    } as unknown as LlmPort;
    await generateQuiz(baseInput(), {
      ingestion: fakeIngestion(),
      llm,
      persistence: fakePersistence(),
    });
    expect(llmGenerateQuiz).toHaveBeenCalled();
  });
});
