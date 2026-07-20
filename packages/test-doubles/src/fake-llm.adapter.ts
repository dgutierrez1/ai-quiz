import type { GeneratedQuestionDto, QuestionPoolDto, QuizSessionProvider } from '@ai-quiz/shared';

// These mirror `apps/api/src/domain/ports/llm.port.ts`. They are re-declared
// rather than imported because this package must NOT depend on `@ai-quiz/api`
// (api devDepends on this package — importing back would be a build cycle).
// Drift is caught at compile time by the conformance test at
// `apps/api/test/doubles/conformance.type-test.ts`, which assigns these fakes
// to the real port types.

export interface FakeChatHistoryMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
}

export interface FakeChatToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface FakeChatToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface FakeChatParams {
  readonly provider: QuizSessionProvider;
  readonly model: string;
  readonly systemContext: string;
  readonly history: readonly FakeChatHistoryMessage[];
  readonly userMessage: string;
  readonly allowFallback: boolean;
  readonly tools?: readonly FakeChatToolDefinition[];
}

export interface FakeChatResult {
  readonly content: string | null;
  readonly model: string;
  readonly thinking?: unknown;
  readonly toolCalls?: readonly FakeChatToolCallRequest[];
}

export interface FakeGenerateQuizParams {
  readonly provider: QuizSessionProvider;
  readonly model: string;
  readonly prompt: string;
  readonly poolSize: number;
  readonly allowFallback: boolean;
}

export interface FakeSummarizeParams {
  readonly text: string;
  readonly provider: QuizSessionProvider;
  readonly model?: string;
}

/**
 * Deterministic pool derived from the prompt, so questions are grounded in
 * whatever document text the caller supplied and pass the generation
 * pipeline's grounding check. Lifted verbatim from the `buildMockPool` that
 * used to live inside `apps/api/src/adapters/llm/llm.adapter.ts`.
 */
export function buildDeterministicPool(prompt: string, poolSize: number): QuestionPoolDto {
  const base = prompt.split(/\s+/).slice(0, 8).join(' ') || 'topic';
  const questions: GeneratedQuestionDto[] = [];
  for (let i = 0; i < poolSize; i += 1) {
    questions.push({
      text: `${base} — question ${i + 1}`,
      type: i % 2 === 0 ? 'single' : 'multiple',
      category: i % 2 === 0 ? 'core' : 'detail',
      explanation: `${base} explanation ${i + 1}`,
      answers: [
        { position: 0, text: `${base} A`, isCorrect: i % 2 === 0 },
        { position: 1, text: `${base} B`, isCorrect: i % 2 !== 0 },
        { position: 2, text: `${base} C`, isCorrect: i % 2 !== 0 },
        { position: 3, text: `${base} D`, isCorrect: i % 2 !== 0 },
      ],
    });
  }
  return Object.freeze({ questions });
}

/**
 * Hard-capped BEFORE word-splitting: a single pathologically long token (no
 * whitespace at all — e.g. an 8000-char boundary-test string) would otherwise
 * survive `.split(/\s+/).slice(0, 12)` unchanged and push the reply over the
 * 8000-char row cap once the suffix is appended.
 */
export function buildDeterministicChatResult(params: FakeChatParams): FakeChatResult {
  const base = params.userMessage.slice(0, 80).split(/\s+/).slice(0, 12).join(' ') || 'your question';
  return { content: `${base} — chat reply (mock)`, model: params.model };
}

/**
 * Hard-truncated to <=200 chars regardless of caller input — mirrors the
 * code-level enforcement `callRealSummarize` applies to a real model's output
 * (Story 4.2 AC #8).
 */
export function buildDeterministicSummary(text: string): string {
  return text.slice(0, 200);
}

/**
 * Fake `LlmPort`.
 *
 * Every control knob is INSTANCE state, not a module global. That is the
 * structural point of this package: the old `setMockLlmResponse()` /
 * `getLastChatParams()` seams were module-level mutable state living in
 * production code, readable and writable by anything in the process. Here the
 * state belongs to an object the test explicitly holds.
 */
export class FakeLlmAdapter {
  /** When set, returned from `generateQuiz` instead of the derived pool. */
  public pool: Readonly<QuestionPoolDto> | null = null;
  /** When set, returned from `chat` instead of the derived reply. */
  public chatResponse: FakeChatResult | null = null;
  /** When set, returned from `summarize` instead of the truncated input. */
  public summarizeResponse: string | null = null;

  /**
   * Replaces the old module-global `getLastChatParams()` inspection hook. Lets
   * a test assert on the EXACT `systemContext` / `tools` / `history` the
   * use-case handed to the LLM — e.g. proving AD-12's redaction guard reaches
   * the real call site — without mocking `fetch`.
   */
  public lastChatParams: FakeChatParams | null = null;
  /** Full call log, for assertions about how many turns a tool loop took. */
  public readonly chatCalls: FakeChatParams[] = [];

  public reset(): void {
    this.pool = null;
    this.chatResponse = null;
    this.summarizeResponse = null;
    this.lastChatParams = null;
    this.chatCalls.length = 0;
  }

  public async generateQuiz(params: FakeGenerateQuizParams): Promise<Readonly<QuestionPoolDto>> {
    return this.pool ?? buildDeterministicPool(params.prompt, params.poolSize);
  }

  public async chat(params: FakeChatParams): Promise<FakeChatResult> {
    this.lastChatParams = params;
    this.chatCalls.push(params);
    return this.chatResponse ?? buildDeterministicChatResult(params);
  }

  public async summarize(params: FakeSummarizeParams): Promise<string> {
    return (this.summarizeResponse ?? buildDeterministicSummary(params.text)).slice(0, 200);
  }
}
