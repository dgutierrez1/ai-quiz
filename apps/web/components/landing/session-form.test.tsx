import type { ProviderListResponse } from '@ai-quiz/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionForm } from './session-form';
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

function renderWithProviders(ui: React.ReactNode): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const mockProviders: ProviderListResponse = {
  minimax: ['MiniMax-M3'],
  openrouter: ['meta-llama/llama-3.3-70b-instruct:free'],
};

function mockSessionErrorOnce(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): void {
  const status = init?.status ?? 200;
  const headers = init?.headers ?? {};
  const sessionResponse = {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'OK',
    headers: {
      get: (name: string): string | null => headers[name.toLowerCase()] ?? null,
    },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
  const providersResponse = {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    text: async () => JSON.stringify(mockProviders),
  } as unknown as Response;
  let phase: 'providers' | 'session' = 'providers';
  globalThis.fetch = vi.fn().mockImplementation(async () => {
    const next = phase === 'providers' ? providersResponse : sessionResponse;
    phase = 'session';
    return next;
  }) as unknown as typeof fetch;
}

describe('SessionForm', () => {
  beforeEach(() => {
    // Default: providers query returns v1 catalog; session POST succeeds.
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/config/providers')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => null },
          text: async () => JSON.stringify(mockProviders),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            id: '11111111-1111-4111-8111-111111111111',
            status: 'ready',
          }),
      } as unknown as Response;
    });
    // Pretend the inline head script has populated a UUID v4.
    window.localStorage.setItem('ai-quiz.user.id', '11111111-1111-4111-8111-111111111111');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('disables Start until URL and strategy are valid (AC #6)', async () => {
    renderWithProviders(<SessionForm />);
    const start = await screen.findByTestId('start-button');
    expect(start).toBeDisabled();

    await userEvent.type(screen.getByTestId('source-url-input'), 'https://example.com/a.md');
    expect(start).toBeDisabled();

    await userEvent.click(screen.getByTestId('strategy-radio-mixed'));
    expect(start).toBeEnabled();
  });

  it('does not pre-select a strategy (AC #4)', async () => {
    renderWithProviders(<SessionForm />);
    for (const value of ['factual', 'comprehension', 'mixed', 'trivia']) {
      const radio = screen.getByTestId(`strategy-radio-${value}`) as HTMLInputElement;
      expect(radio.checked).toBe(false);
    }
  });

  it('resets the model when the provider changes (AC #5)', async () => {
    renderWithProviders(<SessionForm />);
    const providerSelect = (await screen.findByTestId('provider-select')) as HTMLSelectElement;
    expect(providerSelect.value).toBe('minimax');

    await userEvent.selectOptions(providerSelect, 'openrouter');

    const modelSelect = screen.getByTestId('model-select') as HTMLSelectElement;
    expect(modelSelect.value).toBe('meta-llama/llama-3.3-70b-instruct:free');
  });

  it('disables Start when no providers are configured (AC #11)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () => JSON.stringify({} satisfies ProviderListResponse),
    } as unknown as Response);

    renderWithProviders(<SessionForm />);
    await screen.findByText(/No providers configured/i);
    const urlInput = await screen.findByTestId('source-url-input');
    await userEvent.type(urlInput, 'https://example.com/a.md');
    await userEvent.click(screen.getByTestId('strategy-radio-mixed'));
    const start = screen.getByTestId('start-button');
    expect(start).toBeDisabled();
  });

  it('shows rate-limited state with countdown on 429 (AC #10)', async () => {
    mockSessionErrorOnce(
      { error: { code: 'TOO_MANY_REQUESTS', message: 'slow down', requestId: 'r-1' } },
      { status: 429, headers: { 'retry-after': '5' } },
    );

    renderWithProviders(<SessionForm />);
    await userEvent.type(await screen.findByTestId('source-url-input'), 'https://example.com/a.md');
    await userEvent.click(screen.getByTestId('strategy-radio-mixed'));
    await userEvent.click(screen.getByTestId('start-button'));

    expect(await screen.findByTestId('rate-limited-message')).toHaveTextContent(/5 seconds/i);
  });

  it('shows error copy on 400 DOC_TOO_SHORT (AC #9)', async () => {
    mockSessionErrorOnce(
      {
        error: {
          code: 'DOC_TOO_SHORT',
          message: 'document supports only 3 questions',
          requestId: 'r-2',
        },
      },
      { status: 400 },
    );

    renderWithProviders(<SessionForm />);
    await userEvent.type(await screen.findByTestId('source-url-input'), 'https://example.com/a.md');
    await userEvent.click(screen.getByTestId('strategy-radio-mixed'));
    await userEvent.click(screen.getByTestId('start-button'));

    expect(await screen.findByTestId('error-body')).toHaveTextContent(/about 3 questions/i);
  });

  it('POSTs /api/sessions with the full contract (AC #7)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderWithProviders(<SessionForm />);
    await userEvent.type(await screen.findByTestId('source-url-input'), 'https://example.com/a.md');
    await userEvent.type(screen.getByTestId('topic-input'), 'auth');
    await userEvent.click(screen.getByTestId('strategy-radio-comprehension'));
    const qcSelect = screen.getByTestId('question-count-select') as HTMLSelectElement;
    await userEvent.selectOptions(qcSelect, '6');
    await userEvent.click(screen.getByTestId('start-button'));

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find(([arg]) =>
        typeof arg === 'string'
          ? arg.includes('/api/sessions')
          : arg.toString().includes('/api/sessions'),
      );
      expect(call).toBeDefined();
    });
    const call = fetchSpy.mock.calls.find(([arg]) =>
      typeof arg === 'string'
        ? arg.includes('/api/sessions')
        : arg.toString().includes('/api/sessions'),
    )!;
    const init = call[1] as RequestInit | undefined;
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      sourceUrl: 'https://example.com/a.md',
      topic: 'auth',
      strategy: 'comprehension',
      questionCount: 6,
      provider: 'minimax',
      model: 'MiniMax-M3',
    });
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['X-User-Id']).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('prefills and focuses the URL field from a history retry, and calls onPrefillConsumed (Story 5.1 AC #6)', async () => {
    const onPrefillConsumed = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <SessionForm prefillUrl={undefined} onPrefillConsumed={onPrefillConsumed} />
      </QueryClientProvider>,
    );

    const urlInput = await screen.findByTestId('source-url-input');
    expect(urlInput).toHaveValue('');
    expect(onPrefillConsumed).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={client}>
        <SessionForm
          prefillUrl="https://example.com/broken.md"
          onPrefillConsumed={onPrefillConsumed}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(urlInput).toHaveValue('https://example.com/broken.md'));
    await waitFor(() => expect(urlInput).toHaveFocus());
    expect(onPrefillConsumed).toHaveBeenCalledTimes(1);

    // It does not auto-submit — no POST fired as a side effect of the prefill.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const postCalls = fetchMock.mock.calls.filter((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'POST';
    });
    expect(postCalls).toHaveLength(0);
  });
});
