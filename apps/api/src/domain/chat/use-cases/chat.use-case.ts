// apps/api/src/domain/chat/use-cases/chat.use-case.ts
//
// Story 4.1 (persistence + pre-submit guard) + Story 4.2 (Tavily tool loop +
// dual-LLM sanitization), implemented together. Plain exported function
// (not a NestJS-injectable class), consistent with
// `domain/quiz/use-cases/generate-quiz.ts` / `domain/submission/use-cases/submit-answers.use-case.ts`
// (AD-1/AD-2 domain purity — no `@nestjs/*`, `drizzle-orm`, `mastra`,
// `undici`, `node:fetch`; `node:crypto` is plain Node stdlib, not I/O, and is
// used only for the SHA-256 `userIdHash` the tracing privacy contract
// requires — never the raw id).

import { createHash } from 'node:crypto';

import type { ChatHistoryMessage, ChatToolDefinition, LlmPort } from '../../ports/llm.port.js';
import type { QuizRepositoryPort } from '../../ports/quiz-repository.port.js';
import type { InternalUserId } from '../../ports/user-repository.port.js';
import { NotFoundError } from '../../quiz/errors/not-found.error.js';
import type { SubmissionRepositoryPort } from '../../submission/ports/submission-repository.port.js';
import {
  ChatMessageWireSchema,
  type ChatTurnResponseDto,
  ChatTurnResponseSchema,
  type ToolCallDto,
  type WebSearchSourceDto,
} from '../dto/chat.schemas.js';
import { ChatNotAvailableError } from '../errors/chat-not-available.error.js';
import type { ChatRepositoryPort } from '../ports/chat-repository.port.js';
import type { WebSearchPort } from '../ports/web-search.port.js';
import {
  buildReadyContext,
  buildSubmittedContext,
  redactQuestionsForChat,
} from '../services/chat-context.service.js';

// Minimal structural subset of `TracingPort` (Story 1.6/4.2 AD-N9) — declared
// locally rather than imported from `domain/ports/tracing.port.ts` so this
// file has no hard compile-time coupling beyond what it actually calls; any
// real `TracingPort` implementation satisfies this shape.
export interface ChatTracingPort {
  recordGeneration(trace: {
    readonly name: string;
    readonly provider: string;
    readonly model: string;
    readonly input?: string;
    readonly output?: string;
    readonly sessionId?: string;
    readonly userIdHash?: string;
    readonly error?: string;
  }): Promise<void>;
  flush(): Promise<void>;
}

export interface ChatUseCaseDeps {
  readonly quizRepo: QuizRepositoryPort;
  readonly submissionRepo: SubmissionRepositoryPort;
  readonly chatRepo: ChatRepositoryPort;
  readonly llm: LlmPort;
  /** Absent (or `TAVILY_API_KEY` unset) => tool loop never fires (AC #13). */
  readonly webSearch?: WebSearchPort;
  readonly tracing?: ChatTracingPort;
}

export interface ChatUseCaseInput {
  readonly sessionId: string;
  readonly userId: InternalUserId;
  readonly content: string;
}

const MAX_TOOL_ITERATIONS = 2;

const TAVILY_TOOL_DEFINITION: ChatToolDefinition = {
  name: 'tavily_search',
  description:
    'Search the public web for information beyond the quiz source document. Use sparingly — only when the ' +
    'document, the questions, and the results/insights context cannot answer the question.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'the search query' },
    },
    required: ['query'],
  },
};

function assertNever(value: never): never {
  throw new Error(`chat.use-case: unreachable session status ${String(value)}`);
}

function hashUserId(userId: string): string {
  return createHash('sha256').update(userId, 'utf8').digest('hex');
}

function extractQuery(args: Record<string, unknown>): string {
  const query = args.query;
  return typeof query === 'string' ? query : '';
}

/**
 * `ChatUseCase.execute` — Story 4.1 Task 5.
 *
 * The `switch` on `session.status` is THE single most important control-flow
 * rule in this file (AD-12): every branch is explicit, `pending`/`failed`
 * throw before any question/answer content is ever fetched, and the
 * `default: assertNever(...)` makes a future unhandled status a compile-time
 * error rather than a silent fallthrough into an answer-bearing branch.
 */
export async function chat(
  input: ChatUseCaseInput,
  deps: ChatUseCaseDeps,
): Promise<ChatTurnResponseDto> {
  const sessionOrNull = await deps.quizRepo.findByIdAndUserId(input.sessionId, input.userId);
  if (!sessionOrNull) throw new NotFoundError();
  // Rebound to a fresh, never-reassigned const so nested closures below
  // (`callMainAgent`) see the already-non-null type directly, rather than
  // relying on cross-closure narrowing of `sessionOrNull` (TS does not
  // narrow a captured variable's union type inside a nested function
  // declaration, even when it was already null-checked in the outer scope).
  const session = sessionOrNull;

  let systemContext: string;
  switch (session.status) {
    case 'ready': {
      const questions = await deps.submissionRepo.findQuestionsWithAnswersForUser(
        input.sessionId,
        input.userId,
      );
      if (!questions) throw new NotFoundError();
      systemContext = buildReadyContext(redactQuestionsForChat(questions));
      break;
    }
    case 'submitted': {
      const questions = await deps.submissionRepo.findQuestionsWithAnswersForUser(
        input.sessionId,
        input.userId,
      );
      if (!questions) throw new NotFoundError();
      const result = await deps.submissionRepo.getSubmittedResult(input.sessionId, input.userId);
      if (!result) throw new NotFoundError();
      systemContext = buildSubmittedContext({
        finalScore: result.finalScore,
        breakdown: result.breakdown,
        categoryBreakdown: result.categoryBreakdown,
        insights: {
          topicsToStudy: result.insights.topicsToStudy,
          weakCategories: result.insights.weakCategories,
        },
        questions,
      });
      break;
    }
    case 'pending':
    case 'failed':
      // AC #4 — refused with 409 and the current status. Never falls through
      // to a branch that would fetch/expose question or answer content.
      throw new ChatNotAvailableError(session.status);
    default:
      assertNever(session.status);
  }

  const priorHistory = await deps.chatRepo.findRecentForUser(input.sessionId, input.userId);
  // `let`, not `const` — the tool loop below ACCUMULATES onto this array
  // across iterations (each round's assistant turn + tool results get
  // appended), so a second tool round still has the first round's exchange
  // in context. Rebuilding from the ORIGINAL persisted history on every
  // iteration (an earlier draft of this loop did exactly that) silently
  // drops iteration 1's tool exchange once iteration 2 runs.
  let historyMessages: ChatHistoryMessage[] = priorHistory.messages
    .filter((message) => message.content !== null)
    .map((message) => ({ role: message.role, content: message.content as string }));

  const tavilyConfigured = Boolean(process.env.TAVILY_API_KEY) && deps.webSearch !== undefined;
  const collectedToolCalls: ToolCallDto[] = [];
  const collectedSources: WebSearchSourceDto[] = [];
  let toolIterations = 0;

  const userIdHash = hashUserId(input.userId);

  async function callMainAgent(
    history: readonly ChatHistoryMessage[],
    userMessage: string,
    tools: readonly ChatToolDefinition[] | undefined,
  ) {
    const result = await deps.llm.chat({
      provider: session.provider,
      model: session.model,
      systemContext,
      history,
      userMessage,
      allowFallback: true, // AD-6 — chat is the one path fallback is enabled on
      tools,
    });
    await deps.tracing
      ?.recordGeneration({
        name: 'chat-main-agent',
        provider: session.provider,
        model: result.model,
        input: userMessage,
        output: result.content ?? undefined,
        sessionId: input.sessionId,
        userIdHash,
      })
      .catch(() => undefined);
    return result;
  }

  let response = await callMainAgent(
    historyMessages,
    input.content,
    tavilyConfigured ? [TAVILY_TOOL_DEFINITION] : undefined,
  );

  // Tool-execution loop — the counter is a local variable scoped to this one
  // call, never persisted or a class field (Story 4.2 Task 5 / Design ruling
  // #3: not delegated to Mastra's own step-count default).
  while (
    tavilyConfigured &&
    response.toolCalls !== undefined &&
    response.toolCalls.length > 0 &&
    toolIterations < MAX_TOOL_ITERATIONS
  ) {
    toolIterations += 1;
    const toolResultMessages: ChatHistoryMessage[] = [];
    for (const call of response.toolCalls) {
      const query = extractQuery(call.arguments);
      try {
        const result = await deps.webSearch!.search(query, { mainAgentProvider: session.provider });
        collectedToolCalls.push({ name: 'tavily_search', query, summary: result.summary });
        collectedSources.push(...result.sources);
        toolResultMessages.push({ role: 'tool', content: result.summary });
      } catch {
        // Tavily/summarizer failure degrades to "no result for this tool
        // call" — never a 5xx from the chat endpoint (Story 4.2 Task 2/5).
        toolResultMessages.push({ role: 'tool', content: 'no result for this tool call' });
      }
    }

    // Accumulate onto `historyMessages` (not rebuild from the original
    // persisted history) so a second tool round still has the first
    // round's assistant turn + tool results in context.
    historyMessages = [
      ...historyMessages,
      {
        role: 'user',
        content:
          toolIterations === 1
            ? input.content
            : 'Using the tool results above, answer the original question directly.',
      },
      { role: 'assistant', content: response.content ?? '' },
      ...toolResultMessages,
    ];
    const iterationsRemain = toolIterations < MAX_TOOL_ITERATIONS;
    response = await callMainAgent(
      historyMessages,
      'Using the tool results above, answer the original question directly.',
      // Once exhausted, the next call omits `tools` entirely — never `tools: []`
      // — forcing a final text-only answer from whatever was gathered (AC #1/#11).
      iterationsRemain ? [TAVILY_TOOL_DEFINITION] : undefined,
    );
  }

  await deps.tracing?.flush().catch(() => undefined);

  const { userMessage, assistantMessage } = await deps.chatRepo.appendTurn(
    input.sessionId,
    input.userId,
    input.content,
    {
      content: response.content,
      sources: collectedSources.length > 0 ? collectedSources : null,
      toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : null,
      model: response.model,
      thinking: response.thinking ?? null,
    },
  );

  return Object.freeze(
    ChatTurnResponseSchema.parse({
      userMessage: ChatMessageWireSchema.parse(userMessage),
      assistantMessage: ChatMessageWireSchema.parse(assistantMessage),
    }),
  );
}
