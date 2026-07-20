import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResultPageClient } from './result-page-client';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function renderWithProviders(ui: React.ReactNode): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status',
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockReplace.mockClear();
  window.localStorage.setItem('ai-quiz.user.id', SESSION_ID);
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
  window.localStorage.clear();
});

describe('ResultPageClient — status branching', () => {
  it('renders "This session isn\'t available." with no dual-panel/tabs chrome on 404', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404));

    renderWithProviders(<ResultPageClient sessionId={SESSION_ID} />);

    expect(await screen.findByTestId('result-not-found-root')).toHaveTextContent(
      "This session isn't available.",
    );
    expect(screen.queryByTestId('result-page-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('result-tabs-list')).not.toBeInTheDocument();
  });

  it('redirects to /quiz/[id] for a non-submitted status without rendering result content', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sessionId: SESSION_ID, status: 'ready' }));

    renderWithProviders(<ResultPageClient sessionId={SESSION_ID} />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/quiz/${SESSION_ID}`));
    expect(screen.queryByTestId('result-page-shell')).not.toBeInTheDocument();
  });

  it('renders the results shell for a submitted session', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        sessionId: SESSION_ID,
        status: 'submitted',
        finalScore: 3,
        breakdown: [],
        categoryBreakdown: [],
        questions: [],
      }),
    );

    renderWithProviders(<ResultPageClient sessionId={SESSION_ID} />);

    expect(await screen.findByTestId('result-page-shell')).toBeInTheDocument();
    expect(screen.getByTestId('result-h1')).toHaveTextContent('Your results');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
