import type { QuizSessionRow, SessionQuestionRowDto } from '@ai-quiz/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatRepositoryPort } from '../../../src/domain/chat/ports/chat-repository.port.js';
import type { WebSearchPort } from '../../../src/domain/chat/ports/web-search.port.js';
import { chat, type ChatUseCaseDeps } from '../../../src/domain/chat/use-cases/chat.use-case.js';
import type { ChatParams, ChatResult, LlmPort } from '../../../src/domain/ports/llm.port.js';
import type { QuizRepositoryPort } from '../../../src/domain/ports/quiz-repository.port.js';
import type { InternalUserId } from '../../../src/domain/ports/user-repository.port.js';
import type { SubmissionRepositoryPort } from '../../../src/domain/submission/ports/submission-repository.port.js';

const USER_ID = 'user-1' as InternalUserId;
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function baseSession(overrides: Partial<QuizSessionRow> = {}): QuizSessionRow {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    sourceUrl: 'https://example.com/doc.md',
    topic: null,
    strategy: 'mixed',
    provider: 'minimax',
    model: 'MiniMax-M3',
    status: 'ready',
    errorMessage: null,
    questionCount: 5,
    actualCount: null,
    selectedCategories: ['Geography'],
    finalScore: null,
    createdAt: new Date(),
    completedAt: null,
    ...overrides,
  } as QuizSessionRow;
}

const QUESTIONS: SessionQuestionRowDto[] = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    sessionId: SESSION_ID,
    position: 0,
    text: 'What?',
    type: 'single',
    category: 'Geography',
    explanation: 'because',
    answers: [
      { position: 0, text: 'A', isCorrect: true },
      { position: 1, text: 'B', isCorrect: false },
      { position: 2, text: 'C', isCorrect: false },
      { position: 3, text: 'D', isCorrect: false },
    ],
  },
];

function fakeQuizRepo(session: QuizSessionRow | null): QuizRepositoryPort {
  return {
    createSession: vi.fn(),
    findByIdAndUserId: vi.fn().mockResolvedValue(session),
    updateSession: vi.fn(),
    listForUser: vi.fn(),
  };
}

function fakeSubmissionRepo(): SubmissionRepositoryPort {
  return {
    findQuestionsWithAnswersForUser: vi.fn().mockResolvedValue(QUESTIONS),
    findDocumentChunksForUser: vi.fn().mockResolvedValue([]),
    trySubmit: vi.fn(),
    getSubmittedResult: vi.fn(),
  };
}

function fakeChatRepo(): ChatRepositoryPort {
  return {
    appendTurn: vi.fn().mockImplementation(async (sessionId, userId, userContent, assistant) => ({
      userMessage: {
        id: '33333333-3333-4333-8333-333333333333',
        sessionId,
        role: 'user',
        content: userContent,
        sources: null,
        toolCalls: null,
        model: null,
        thinking: null,
        scrubbedAt: null,
        createdAt: new Date(),
      },
      assistantMessage: {
        id: '44444444-4444-4444-8444-444444444444',
        sessionId,
        role: 'assistant',
        content: assistant.content,
        sources: assistant.sources,
        toolCalls: assistant.toolCalls,
        model: assistant.model,
        thinking: assistant.thinking,
        scrubbedAt: null,
        createdAt: new Date(),
      },
    })),
    findRecentForUser: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
  };
}

describe('ChatUseCase — tool-iteration cap (Story 4.2 AC #1/#11)', () => {
  it('caps at 2 tool iterations; the 3rd chat() call omits `tools` entirely', async () => {
    const chatCalls: ChatParams[] = [];
    const llm: LlmPort = {
      generateQuiz: vi.fn(),
      chat: vi.fn().mockImplementation(async (params: ChatParams): Promise<ChatResult> => {
        chatCalls.push(params);
        if (params.tools && params.tools.length > 0) {
          return {
            content: null,
            model: 'MiniMax-M3',
            toolCalls: [
              { id: `call-${chatCalls.length}`, name: 'tavily_search', arguments: { query: 'x' } },
            ],
          };
        }
        return { content: 'final answer', model: 'MiniMax-M3' };
      }),
      summarize: vi.fn(),
    };
    const search = vi
      .fn()
      .mockResolvedValue({ summary: 'a summary', sources: [{ title: 'T', url: 'https://x.com' }] });
    const webSearch: WebSearchPort = { search };

    process.env.TAVILY_API_KEY = 'tvly-test';
    const deps: ChatUseCaseDeps = {
      quizRepo: fakeQuizRepo(baseSession()),
      submissionRepo: fakeSubmissionRepo(),
      chatRepo: fakeChatRepo(),
      llm,
      webSearch,
    };

    await chat({ sessionId: SESSION_ID, userId: USER_ID, content: 'search the web for me' }, deps);
    delete process.env.TAVILY_API_KEY;

    expect(search).toHaveBeenCalledTimes(2);
    expect(chatCalls).toHaveLength(3);
    expect(chatCalls[0]!.tools).toBeDefined();
    expect(chatCalls[1]!.tools).toBeDefined();
    expect(chatCalls[2]!.tools).toBeUndefined();
  });

  it('TAVILY_API_KEY unset: tools are never populated, main agent still returns a plain answer', async () => {
    delete process.env.TAVILY_API_KEY;
    const chatCalls: ChatParams[] = [];
    const llm: LlmPort = {
      generateQuiz: vi.fn(),
      chat: vi.fn().mockImplementation(async (params: ChatParams): Promise<ChatResult> => {
        chatCalls.push(params);
        return { content: 'a plain answer', model: 'MiniMax-M3' };
      }),
      summarize: vi.fn(),
    };
    const search = vi.fn();
    const webSearch: WebSearchPort = { search };

    const deps: ChatUseCaseDeps = {
      quizRepo: fakeQuizRepo(baseSession()),
      submissionRepo: fakeSubmissionRepo(),
      chatRepo: fakeChatRepo(),
      llm,
      webSearch, // present, but TAVILY_API_KEY absent must still suppress tools
    };

    const result = await chat({ sessionId: SESSION_ID, userId: USER_ID, content: 'hello' }, deps);

    expect(search).not.toHaveBeenCalled();
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0]!.tools).toBeUndefined();
    expect(result.assistantMessage.content).toBe('a plain answer');
  });

  it('persists tool_calls and sources on the assistant message when tools were used', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test';
    let callCount = 0;
    const llm: LlmPort = {
      generateQuiz: vi.fn(),
      chat: vi.fn().mockImplementation(async (): Promise<ChatResult> => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: null,
            model: 'MiniMax-M3',
            toolCalls: [
              { id: 'call-1', name: 'tavily_search', arguments: { query: 'latest news' } },
            ],
          };
        }
        return { content: 'grounded answer', model: 'MiniMax-M3' };
      }),
      summarize: vi.fn(),
    };
    const webSearch: WebSearchPort = {
      search: vi.fn().mockResolvedValue({
        summary: 'web summary',
        sources: [{ title: 'Src', url: 'https://s.com' }],
      }),
    };
    const chatRepo = fakeChatRepo();
    const deps: ChatUseCaseDeps = {
      quizRepo: fakeQuizRepo(baseSession()),
      submissionRepo: fakeSubmissionRepo(),
      chatRepo,
      llm,
      webSearch,
    };

    const result = await chat(
      { sessionId: SESSION_ID, userId: USER_ID, content: 'whats new' },
      deps,
    );
    delete process.env.TAVILY_API_KEY;

    expect(result.assistantMessage.toolCalls).toEqual([
      { name: 'tavily_search', query: 'latest news', summary: 'web summary' },
    ]);
    expect(result.assistantMessage.sources).toEqual([{ title: 'Src', url: 'https://s.com' }]);
  });

  it('a Tavily failure degrades to "no result for this tool call" — never throws out of the use-case', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test';
    let callCount = 0;
    const llm: LlmPort = {
      generateQuiz: vi.fn(),
      chat: vi.fn().mockImplementation(async (): Promise<ChatResult> => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: null,
            model: 'MiniMax-M3',
            toolCalls: [{ id: 'call-1', name: 'tavily_search', arguments: { query: 'x' } }],
          };
        }
        return { content: 'answered without the tool result', model: 'MiniMax-M3' };
      }),
      summarize: vi.fn(),
    };
    const webSearch: WebSearchPort = {
      search: vi.fn().mockRejectedValue(new Error('tavily down')),
    };
    const deps: ChatUseCaseDeps = {
      quizRepo: fakeQuizRepo(baseSession()),
      submissionRepo: fakeSubmissionRepo(),
      chatRepo: fakeChatRepo(),
      llm,
      webSearch,
    };

    const result = await chat({ sessionId: SESSION_ID, userId: USER_ID, content: 'x' }, deps);
    delete process.env.TAVILY_API_KEY;
    expect(result.assistantMessage.content).toBe('answered without the tool result');
  });
});

describe('ChatUseCase — pre-submit guard exhaustiveness (Story 4.1 AC #4)', () => {
  const llm: LlmPort = {
    generateQuiz: vi.fn(),
    chat: vi.fn().mockResolvedValue({ content: 'reply', model: 'MiniMax-M3' }),
    summarize: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(['pending', 'failed'] as const)(
    'status=%s throws ChatNotAvailableError, never calls submissionRepo',
    async (status) => {
      const submissionRepo = fakeSubmissionRepo();
      const deps: ChatUseCaseDeps = {
        quizRepo: fakeQuizRepo(baseSession({ status })),
        submissionRepo,
        chatRepo: fakeChatRepo(),
        llm,
      };
      await expect(
        chat({ sessionId: SESSION_ID, userId: USER_ID, content: 'x' }, deps),
      ).rejects.toMatchObject({
        currentStatus: status,
      });
      expect(submissionRepo.findQuestionsWithAnswersForUser).not.toHaveBeenCalled();
    },
  );
});
