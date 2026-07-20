import type { QuestionPoolDto, QuizSessionProvider } from '@ai-quiz/shared';

export type GenerateQuizParams = {
  readonly provider: QuizSessionProvider;
  readonly model: string;
  readonly prompt: string;
  readonly poolSize: number;
  /** AD-6 — must be false on the generation path; fallback is chat-only. */
  readonly allowFallback: boolean;
};

// ── Story 4.1/4.2 — chat() real shape + summarize() dual-LLM boundary ──────
//
// `chat()`'s original placeholder shape (`{prompt, allowFallback}`) was never
// called by any real code path (Story 2.3 left it a stub) — this is a
// backward-compatible-in-practice, additive redefinition, not a breaking
// change to a live caller.

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatHistoryMessage {
  readonly role: ChatRole;
  readonly content: string;
}

/** JSON-schema-shaped tool definition, OpenAI-compatible function-calling shape. */
export interface ChatToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ChatToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface ChatParams {
  readonly provider: QuizSessionProvider;
  readonly model: string;
  readonly systemContext: string;
  readonly history: readonly ChatHistoryMessage[];
  readonly userMessage: string;
  /** AD-6 — chat is the one path where transparent provider fallback fires. */
  readonly allowFallback: boolean;
  /**
   * Story 4.2 — additive. Omitted entirely (not an empty array) once the
   * 2-iteration tool cap is exhausted or when no search provider is
   * configured, forcing a tools-omitted final text-only turn.
   */
  readonly tools?: readonly ChatToolDefinition[];
}

export interface ChatResult {
  /** `null` when the model only requested tool calls this turn. */
  readonly content: string | null;
  readonly model: string;
  readonly thinking?: unknown;
  readonly toolCalls?: readonly ChatToolCallRequest[];
}

export interface SummarizeParams {
  readonly text: string;
  readonly provider: QuizSessionProvider;
  readonly model?: string;
}

export interface LlmPort {
  generateQuiz(params: GenerateQuizParams): Promise<Readonly<QuestionPoolDto>>;
  chat(params: ChatParams): Promise<ChatResult>;
  /**
   * Story 4.2 AD-13 dual-LLM pattern — a tool-free boundary distinct from
   * `chat()`. No `tools` parameter exists on this signature at all, so it is
   * structurally impossible (not just prompt-discouraged) to pass tools into
   * a summarization call.
   */
  summarize(params: SummarizeParams): Promise<string>;
}

export const LLM_PORT = Symbol('LlmPort');
