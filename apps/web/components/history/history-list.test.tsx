import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionSummaryDto } from '../../lib/api';
import { HistoryList } from './history-list';

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

function summary(overrides: Partial<SessionSummaryDto> = {}): SessionSummaryDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sourceUrl: 'https://example.com/a.md',
    status: 'submitted',
    createdAt: '2026-07-15T09:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HistoryList — empty state (AC #8)', () => {
  it('shows the verbatim Trust & Disclosure copy when there are zero sessions', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ sessions: [], hasMore: false }));

    renderWithProviders(<HistoryList onRetry={vi.fn()} />);

    expect(await screen.findByTestId('empty-history-state')).toHaveTextContent(
      "Sessions are saved to this browser. There's no account to sign in to.",
    );
    expect(screen.queryByTestId('history-row-skeleton')).not.toBeInTheDocument();
  });
});

describe('HistoryList — loading state', () => {
  it('shows skeleton rows while the first page is in flight', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;

    renderWithProviders(<HistoryList onRetry={vi.fn()} />);

    expect(screen.getAllByTestId('history-row-skeleton').length).toBeGreaterThan(0);
    resolveFetch?.(jsonResponse({ sessions: [], hasMore: false }));
    await waitFor(() => expect(screen.getByTestId('empty-history-state')).toBeInTheDocument());
  });
});

describe('HistoryList — populated (AC #2, #9)', () => {
  it('renders one row per session, source URL/status/date, and hides load-more when hasMore is false', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        sessions: [
          summary({ id: 's1', status: 'submitted' }),
          summary({ id: 's2', status: 'failed', sourceUrl: 'https://example.com/broken.md' }),
        ],
        hasMore: false,
      }),
    );

    renderWithProviders(<HistoryList onRetry={vi.fn()} />);

    expect(await screen.findByTestId('history-row-s1')).toBeInTheDocument();
    expect(screen.getByTestId('history-row-s2')).toBeInTheDocument();
    expect(screen.queryByTestId('history-load-more')).not.toBeInTheDocument();
    // Exactly one mount of the list content, regardless of how many rows.
    expect(screen.getAllByTestId('history-list')).toHaveLength(1);
  });

  it('shows load-more when hasMore is true and fetches the next page on click', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      calls += 1;
      if (String(url).includes('before=')) {
        return jsonResponse({ sessions: [summary({ id: 's2' })], hasMore: false });
      }
      return jsonResponse({ sessions: [summary({ id: 's1' })], hasMore: true });
    }) as unknown as typeof fetch;

    renderWithProviders(<HistoryList onRetry={vi.fn()} />);

    const loadMore = await screen.findByTestId('history-load-more');
    await userEvent.click(loadMore);

    await waitFor(() => expect(screen.getByTestId('history-row-s2')).toBeInTheDocument());
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe('HistoryList — retry wiring (AC #6)', () => {
  it('forwards onRetry with the failed row source URL', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        sessions: [summary({ id: 's3', status: 'failed', sourceUrl: 'https://example.com/x.md' })],
        hasMore: false,
      }),
    );
    const onRetry = vi.fn();

    renderWithProviders(<HistoryList onRetry={onRetry} />);

    const retryButton = await screen.findByTestId('history-row-retry-s3');
    await userEvent.click(retryButton);

    expect(onRetry).toHaveBeenCalledWith('https://example.com/x.md');
  });
});
