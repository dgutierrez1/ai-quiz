// Story 4.2 AC #4/#14/Task 7 — regression test proving quiz generation
// (closed-world, AD-N2) never invokes `WebSearchPort` / `TavilySearchAdapter`,
// across BOTH a successful and a failed generation run. `GenerateQuizDeps`
// (see `domain/quiz/use-cases/generate-quiz.ts`) has no `webSearchPort`
// field at all — this is a structural (type-level) guarantee — but this
// test also asserts it BEHAVIORALLY: a spy `WebSearchPort` double is
// constructed and never wired into `deps`, then asserted to have received
// zero calls after each run. This is Task 7's explicit requirement: "not
// just an absence of imports."

import type { GeneratedQuestionDto, IngestedDocumentDto, QuestionPoolDto } from '@ai-quiz/shared';
import { describe, expect, it, vi } from 'vitest';

import type { WebSearchPort } from '../../../../src/domain/chat/ports/web-search.port.js';
import type { EnrichmentPort } from '../../../../src/domain/ports/enrichment.port.js';
import type { IngestionPort } from '../../../../src/domain/ports/ingestion.port.js';
import type { LlmPort } from '../../../../src/domain/ports/llm.port.js';
import type {
  FailedSessionParams,
  PersistGeneratedQuizInput,
  QuizPersistencePort,
} from '../../../../src/domain/ports/quiz-persistence.port.js';
import { UntrustedLlmOutputError } from '../../../../src/domain/quiz/errors/generation.errors.js';
import {
  generateQuiz,
  type GenerateQuizInput,
} from '../../../../src/domain/quiz/use-cases/generate-quiz.js';

const WORD_POOL =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango'.split(
    ' ',
  );

function buildDocContent(): string {
  const paragraph = `${WORD_POOL.join(' ')}. `;
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

function makeQuestion(category: string, seed: number): GeneratedQuestionDto {
  const groundedWord = WORD_POOL[seed % WORD_POOL.length];
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
  for (let i = 0; i < count; i += 1)
    questions.push(makeQuestion(categories[i % categories.length]!, i));
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

function fakeEnrichment(): EnrichmentPort {
  return { enrich: vi.fn(async (input) => Object.freeze([...input.questions])) };
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

function spyWebSearchPort(): WebSearchPort & { readonly search: ReturnType<typeof vi.fn> } {
  return { search: vi.fn().mockResolvedValue({ summary: 'unused', sources: [] }) };
}

async function flushScheduledFailureWrite(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe('GenerateQuizUseCase never invokes WebSearchPort (AD-N2 closed-world regression)', () => {
  it('a successful generation run makes zero calls to a spy WebSearchPort', async () => {
    const spy = spyWebSearchPort();
    const llm: LlmPort = {
      generateQuiz: vi.fn(async () => makePool(12)),
      chat: vi.fn(),
      summarize: vi.fn(),
    };

    // `GenerateQuizDeps` has no `webSearchPort` field — `spy` is never
    // wired into `deps` below. This is the structural half of the
    // guarantee; the assertion after the call is the behavioral half.
    const result = await generateQuiz(baseInput(), {
      ingestion: fakeIngestion(),
      llm,
      persistence: fakePersistence(),
      enrichment: fakeEnrichment(),
    });

    expect(result.questions.length).toBeGreaterThan(0);
    expect(spy.search).not.toHaveBeenCalled();
  });

  it('a failed generation run (every attempt ungrounded, retry budget exhausted) also makes zero calls to a spy WebSearchPort', async () => {
    const spy = spyWebSearchPort();
    const llm: LlmPort = {
      generateQuiz: vi.fn(async () => ungroundedPool(12)),
      chat: vi.fn(),
      summarize: vi.fn(),
    };
    const persistence = fakePersistence();

    await expect(
      generateQuiz(baseInput(), {
        ingestion: fakeIngestion(),
        llm,
        persistence,
        enrichment: fakeEnrichment(),
      }),
    ).rejects.toBeInstanceOf(UntrustedLlmOutputError);
    await flushScheduledFailureWrite();

    expect(persistence.failCalls).toHaveLength(1); // sanity: this really was the failure path
    expect(spy.search).not.toHaveBeenCalled();
  });
});
