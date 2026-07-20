import type { SessionQuestionWireDto } from '@ai-quiz/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReadySessionDetail } from '../../lib/types';
import { QuizRunner } from './quiz-runner';

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const QUESTIONS: readonly SessionQuestionWireDto[] = [
  {
    id: 'q1',
    sessionId: SESSION_ID,
    position: 0,
    text: 'What is 2 + 2?',
    type: 'single',
    category: 'Math',
    explanation: '',
    answers: [
      { position: 0, text: '3' },
      { position: 1, text: '4' },
      { position: 2, text: '5' },
      { position: 3, text: '6' },
    ],
  },
  {
    id: 'q2',
    sessionId: SESSION_ID,
    position: 1,
    text: 'Pick the even numbers.',
    type: 'multiple',
    category: 'Math',
    explanation: '',
    answers: [
      { position: 0, text: '1' },
      { position: 1, text: '2' },
      { position: 2, text: '3' },
      { position: 3, text: '4' },
    ],
  },
];

function readySession(overrides: Partial<ReadySessionDetail> = {}): ReadySessionDetail {
  return {
    sessionId: SESSION_ID,
    status: 'ready',
    questionCount: 2,
    questions: QUESTIONS,
    ...overrides,
  };
}

function renderWithProviders(ui: React.ReactNode): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  const status = init?.status ?? 200;
  const headers = init?.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status',
    headers: { get: (name: string): string | null => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockGetSession(body: unknown, init?: { status?: number }): void {
  globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/submit')) {
      throw new Error('unexpected submit call in this test');
    }
    if (url.includes(`/api/sessions/${SESSION_ID}`)) {
      return jsonResponse(body, init);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  window.localStorage.setItem('ai-quiz.user.id', SESSION_ID);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('QuizRunner — status branching', () => {
  it('renders the first question for a ready session', async () => {
    mockGetSession(readySession());
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);

    expect(await screen.findByTestId('question-card')).toBeInTheDocument();
    expect(screen.getByTestId('question-text')).toHaveTextContent('What is 2 + 2?');
    expect(screen.getByTestId('position-indicator')).toHaveTextContent('1 of 2');
  });

  it('never shuffles answer options — renders positions 0-3 in server order', async () => {
    mockGetSession(readySession());
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);
    await screen.findByTestId('question-card');

    const options = screen.getAllByTestId(/^answer-option-\d$/);
    expect(options.map((el) => el.textContent)).toEqual(['3', '4', '5', '6']);
  });

  it('redirects to /result/[id] on a submitted session without rendering quiz content', async () => {
    mockGetSession({ sessionId: SESSION_ID, status: 'submitted' });
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/result/${SESSION_ID}`));
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument();
  });

  it('renders ErrorState with a retry that routes to / for a failed session', async () => {
    mockGetSession({
      sessionId: SESSION_ID,
      status: 'failed',
      errorMessage: 'grounding check failed',
    });
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);

    expect(await screen.findByTestId('quiz-failed-root')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('quiz-failed-retry'));
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('renders the pending state with a manual refresh action, no polling', async () => {
    mockGetSession({ sessionId: SESSION_ID, status: 'pending' });
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);

    expect(await screen.findByTestId('quiz-pending-root')).toBeInTheDocument();
    expect(screen.getByTestId('quiz-pending-refresh')).toBeInTheDocument();
    expect(screen.getByTestId('quiz-pending-home-link')).toHaveAttribute('href', '/');
  });

  it('renders "This session isn\'t available." with no chrome on 404', async () => {
    mockGetSession({ error: { code: 'NOT_FOUND', message: 'not found' } }, { status: 404 });
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);

    expect(await screen.findByTestId('quiz-not-found-root')).toBeInTheDocument();
    expect(screen.getByTestId('quiz-not-found-title')).toHaveTextContent(
      "This session isn't available.",
    );
    expect(screen.queryByTestId('question-card')).not.toBeInTheDocument();
  });
});

describe('QuizRunner — gating and answer persistence', () => {
  it('disables Next until at least one option is selected, single-select replaces the choice', async () => {
    mockGetSession(readySession());
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);
    await screen.findByTestId('question-card');

    const next = screen.getByTestId('quiz-next-button');
    expect(next).toBeDisabled();

    await userEvent.click(screen.getByTestId('answer-option-input-1'));
    expect(next).toBeEnabled();

    await userEvent.click(screen.getByTestId('answer-option-input-2'));
    expect((screen.getByTestId('answer-option-input-1') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('answer-option-input-2') as HTMLInputElement).checked).toBe(true);
  });

  it('multiple-select toggles independently and never hints the correct count', async () => {
    mockGetSession(readySession());
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);
    await screen.findByTestId('question-card');
    await userEvent.click(screen.getByTestId('answer-option-input-1'));
    await userEvent.click(screen.getByTestId('quiz-next-button'));

    await screen.findByText('Pick the even numbers.');
    await userEvent.click(screen.getByTestId('answer-option-input-1'));
    await userEvent.click(screen.getByTestId('answer-option-input-3'));
    expect((screen.getByTestId('answer-option-input-1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('answer-option-input-3') as HTMLInputElement).checked).toBe(true);

    // Toggling off again.
    await userEvent.click(screen.getByTestId('answer-option-input-1'));
    expect((screen.getByTestId('answer-option-input-1') as HTMLInputElement).checked).toBe(false);
  });

  it('persists answers across Previous/Next within the session', async () => {
    mockGetSession(readySession());
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);
    await screen.findByTestId('question-card');

    await userEvent.click(screen.getByTestId('answer-option-input-1'));
    await userEvent.click(screen.getByTestId('quiz-next-button'));
    await screen.findByText('Pick the even numbers.');

    await userEvent.click(screen.getByTestId('quiz-previous-button'));
    await screen.findByText('What is 2 + 2?');
    expect((screen.getByTestId('answer-option-input-1') as HTMLInputElement).checked).toBe(true);
  });

  it('disables Previous on the first question and shows Submit on the last', async () => {
    mockGetSession(readySession());
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);
    await screen.findByTestId('question-card');
    expect(screen.getByTestId('quiz-previous-button')).toBeDisabled();

    await userEvent.click(screen.getByTestId('answer-option-input-1'));
    await userEvent.click(screen.getByTestId('quiz-next-button'));

    await screen.findByText('Pick the even numbers.');
    expect(screen.getByTestId('quiz-previous-button')).toBeEnabled();
    expect(screen.getByTestId('quiz-next-button')).toHaveTextContent('Submit');
  });

  it('shows the shortfall note once, above the first question only, when actualCount < questionCount', async () => {
    mockGetSession(readySession({ actualCount: 1, questionCount: 2 }));
    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);
    await screen.findByTestId('question-card');

    expect(screen.getByTestId('shortfall-note')).toHaveTextContent(/supported.*1.*rather than 2/i);

    await userEvent.click(screen.getByTestId('answer-option-input-1'));
    await userEvent.click(screen.getByTestId('quiz-next-button'));
    await screen.findByText('Pick the even numbers.');
    expect(screen.queryByTestId('shortfall-note')).not.toBeInTheDocument();
  });
});

describe('QuizRunner — submit flow', () => {
  async function answerBothQuestions(): Promise<void> {
    await screen.findByTestId('question-card');
    await userEvent.click(screen.getByTestId('answer-option-input-1'));
    await userEvent.click(screen.getByTestId('quiz-next-button'));
    await screen.findByText('Pick the even numbers.');
    await userEvent.click(screen.getByTestId('answer-option-input-1'));
  }

  it('POSTs exactly one response per question and navigates to /result/[id] on success', async () => {
    let submitBody: unknown;
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/submit')) {
          submitBody = JSON.parse(String(init?.body));
          return jsonResponse({
            sessionId: SESSION_ID,
            finalScore: 3,
            breakdown: [],
            categoryBreakdown: [],
          });
        }
        if (url.includes(`/api/sessions/${SESSION_ID}`)) {
          return jsonResponse(readySession());
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);
    await answerBothQuestions();
    await userEvent.click(screen.getByTestId('quiz-next-button'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/result/${SESSION_ID}`));
    expect(submitBody).toMatchObject({
      responses: [
        { questionId: 'q1', selected: [1] },
        { questionId: 'q2', selected: [1] },
      ],
    });
  });

  it('shows RateLimitedState on a 429 submit response, preserving answer state', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/submit')) {
        return jsonResponse(
          { error: { code: 'TOO_MANY_REQUESTS', message: 'slow down' } },
          { status: 429, headers: { 'retry-after': '3' } },
        );
      }
      return jsonResponse(readySession());
    }) as unknown as typeof fetch;

    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);
    await answerBothQuestions();
    await userEvent.click(screen.getByTestId('quiz-next-button'));

    expect(await screen.findByTestId('submit-rate-limited-root')).toHaveTextContent(/3 seconds/i);
  });

  it('shows ErrorState with retry on a generic submit failure', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/submit')) {
        return jsonResponse(
          { error: { code: 'INTERNAL_ERROR', message: 'boom' } },
          { status: 500 },
        );
      }
      return jsonResponse(readySession());
    }) as unknown as typeof fetch;

    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);
    await answerBothQuestions();
    await userEvent.click(screen.getByTestId('quiz-next-button'));

    expect(await screen.findByTestId('submit-error-root')).toBeInTheDocument();
  });

  it('re-fetches the session on a 409 submit response instead of showing a generic error', async () => {
    let getCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/submit')) {
        return jsonResponse(
          { error: { code: 'CONFLICT', message: 'not ready', status: 'failed' } },
          { status: 409 },
        );
      }
      getCallCount += 1;
      if (getCallCount === 1) return jsonResponse(readySession());
      return jsonResponse({ sessionId: SESSION_ID, status: 'failed', errorMessage: 'boom' });
    }) as unknown as typeof fetch;

    renderWithProviders(<QuizRunner sessionId={SESSION_ID} />);
    await answerBothQuestions();
    await userEvent.click(screen.getByTestId('quiz-next-button'));

    expect(await screen.findByTestId('quiz-failed-root')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('quiz-failed-root')).getByTestId('quiz-failed-retry'),
    ).toBeInTheDocument();
  });
});
