import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessageDto } from '../../lib/api';
import { ChatPanel } from './chat-panel';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function renderWithProviders(ui: React.ReactNode): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status',
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function assistantMessage(id: string, content: string): ChatMessageDto {
  return {
    id,
    sessionId: SESSION_ID,
    role: 'assistant',
    content,
    sources: null,
    toolCalls: null,
    model: 'minimax/MiniMax-M3',
    thinking: null,
    createdAt: new Date().toISOString(),
  };
}

function userMessage(id: string, content: string): ChatMessageDto {
  return {
    id,
    sessionId: SESSION_ID,
    role: 'user',
    content,
    sources: null,
    toolCalls: null,
    model: null,
    thinking: null,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatPanel — empty state (AC #3)', () => {
  it('renders the empty state when history is empty, and a quick-action chip sends immediately', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { content: string };
        expect(body.content).toBe('What should I study next?');
        return jsonResponse({
          userMessage: userMessage('u1', body.content),
          assistantMessage: assistantMessage(
            'a1',
            'Focus on WebSockets — §3.2 covers retry semantics.',
          ),
        });
      }
      return jsonResponse({ messages: [] });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ChatPanel sessionId={SESSION_ID} />);

    expect(await screen.findByTestId('chat-empty-state')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('chat-quick-action-study-next'));

    await waitFor(() => {
      expect(screen.getByText(/Focus on WebSockets/)).toBeInTheDocument();
    });
  });
});

describe('ChatPanel — sending state (AC #4)', () => {
  it('shows an optimistic bubble, a typing indicator, and disables the input while in flight', async () => {
    let resolvePost: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      return jsonResponse({ messages: [] });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ChatPanel sessionId={SESSION_ID} />);
    expect(await screen.findByTestId('chat-empty-state')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('chat-input'), 'What is a transport?');
    await userEvent.click(screen.getByTestId('chat-send'));

    // Optimistic bubble appears immediately, input clears, send disables.
    expect(await screen.findByText('What is a transport?')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toHaveValue('');
    expect(screen.getByTestId('chat-send')).toBeDisabled();
    expect(screen.getByTestId('chat-typing-indicator')).toHaveTextContent('Thinking…');

    resolvePost?.(
      jsonResponse({
        userMessage: userMessage('u1', 'x'),
        assistantMessage: assistantMessage('a1', 'y'),
      }),
    );
    // The input itself re-enables once the request lands — the send
    // button stays disabled only because the (now-cleared) input is empty.
    await waitFor(() => expect(screen.getByTestId('chat-input')).not.toBeDisabled());
    expect(screen.queryByTestId('chat-typing-indicator')).not.toBeInTheDocument();
  });
});

describe('ChatPanel — error state (AC #5)', () => {
  it('flips the optimistic message to an error state with Retry, preserving the drafted text', async () => {
    let postCallCount = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postCallCount += 1;
        if (postCallCount === 1) {
          return jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, 500);
        }
        return jsonResponse({
          userMessage: userMessage('u1', 'retry me'),
          assistantMessage: assistantMessage('a1', 'ok now'),
        });
      }
      return jsonResponse({ messages: [] });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ChatPanel sessionId={SESSION_ID} />);
    expect(await screen.findByTestId('chat-empty-state')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('chat-input'), 'retry me');
    await userEvent.click(screen.getByTestId('chat-send'));

    const retryButton = await screen.findByTestId('chat-message-retry');
    // The drafted text is never silently discarded.
    expect(screen.getByText('retry me')).toBeInTheDocument();

    await userEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText(/ok now/)).toBeInTheDocument());
    expect(postCallCount).toBe(2);
  });

  it('reuses RateLimitedState for a 429 instead of a generic error banner', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse({ error: { code: 'TOO_MANY_REQUESTS', message: 'slow down' } }, 429, {
          'retry-after': '7',
        });
      }
      return jsonResponse({ messages: [] });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ChatPanel sessionId={SESSION_ID} />);
    expect(await screen.findByTestId('chat-empty-state')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('chat-input'), 'too fast');
    await userEvent.click(screen.getByTestId('chat-send'));

    expect(await screen.findByTestId('chat-rate-limited-root')).toHaveTextContent(
      'Try again in 7 seconds.',
    );
    expect(screen.getByTestId('chat-input')).toBeDisabled();
  });
});

describe('ChatPanel — tombstoned messages (AC #6)', () => {
  it('renders a neutral placeholder for a null-content message loaded from history, without crashing', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        messages: [{ ...assistantMessage('t1', null as unknown as string), content: null }],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ChatPanel sessionId={SESSION_ID} />);

    expect(await screen.findByTestId('chat-message-tombstone')).toHaveTextContent(
      'This message was removed after 7 days.',
    );
  });
});

describe('ChatPanel — "view older" (AC #2)', () => {
  it('fetches with a `before` cursor param, not offset/limit', async () => {
    const initialBatch: ChatMessageDto[] = Array.from({ length: 50 }, (_, i) =>
      userMessage(`m${i}`, `message ${i}`),
    ).map((m, i) => ({ ...m, createdAt: new Date(2026, 0, 1, 0, i).toISOString() }));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('before=')) {
        return jsonResponse({ messages: [userMessage('older-1', 'an older message')] });
      }
      return jsonResponse({ messages: initialBatch });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ChatPanel sessionId={SESSION_ID} />);

    const viewOlder = await screen.findByTestId('chat-view-older');
    await userEvent.click(viewOlder);

    await waitFor(() => expect(screen.getByText('an older message')).toBeInTheDocument());

    const olderCall = fetchMock.mock.calls.find(([url]: [string]) =>
      (url as string).includes('before='),
    );
    expect(olderCall).toBeDefined();
    const calledUrl = String(olderCall?.[0]);
    expect(calledUrl).toContain('before=');
    expect(calledUrl).not.toContain('offset=');
    expect(calledUrl).not.toContain('limit=');
    // The cursor is the oldest currently-loaded message's createdAt.
    expect(calledUrl).toContain(encodeURIComponent(initialBatch[0]!.createdAt));
  });
});

describe('ChatPanel — Explain Qn prefill (AC #7)', () => {
  it('populates the input from pendingPrefill, focuses it, and calls onPrefillConsumed — without sending', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ messages: [] }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const onPrefillConsumed = vi.fn();

    renderWithProviders(
      <ChatPanel
        sessionId={SESSION_ID}
        pendingPrefill="Explain question 3 — I answered incorrectly: Option B"
        onPrefillConsumed={onPrefillConsumed}
      />,
    );

    const input = await screen.findByTestId('chat-input');
    await waitFor(() =>
      expect(input).toHaveValue('Explain question 3 — I answered incorrectly: Option B'),
    );
    await waitFor(() => expect(input).toHaveFocus());
    expect(onPrefillConsumed).toHaveBeenCalledTimes(1);

    // Nothing sent as a side effect of the prefill.
    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(0);
  });
});
