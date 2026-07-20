import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HistorySidebar } from './history-sidebar';

function renderWithProviders(ui: React.ReactNode): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HistorySidebar — single-mount guard (AC #11)', () => {
  it('never renders history-list twice, before, during, or after opening the sheet', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ sessions: [], hasMore: false }));

    renderWithProviders(<HistorySidebar onRetry={vi.fn()} />);

    // Closed: the aside's copy is the only one mounted.
    await waitFor(() => expect(screen.getAllByTestId('history-list')).toHaveLength(1));
    expect(screen.queryByTestId('history-sidebar-sheet')).not.toBeInTheDocument();

    // Opening the sheet unmounts the aside's copy and mounts the sheet's —
    // still exactly one at every instant.
    await userEvent.click(screen.getByTestId('history-sheet-trigger'));
    await waitFor(() => expect(screen.getByTestId('history-sidebar-sheet')).toBeInTheDocument());
    expect(screen.getAllByTestId('history-list')).toHaveLength(1);

    // Closing returns to exactly one (the aside's).
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('history-sidebar-sheet')).not.toBeInTheDocument(),
    );
    expect(screen.getAllByTestId('history-list')).toHaveLength(1);
  });

  it('the aside panel is a landmark and always present in the DOM (hidden below lg via CSS only)', () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ sessions: [], hasMore: false }));

    renderWithProviders(<HistorySidebar onRetry={vi.fn()} />);

    const aside = screen.getByTestId('history-sidebar-panel');
    expect(aside.tagName).toBe('ASIDE');
    expect(aside).toHaveAttribute('aria-label', 'Session history');
    expect(aside.className).toContain('hidden');
    expect(aside.className).toContain('lg:block');
  });

  it('the sheet trigger is lg:hidden — the only class governing the structural collapse', () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ sessions: [], hasMore: false }));

    renderWithProviders(<HistorySidebar onRetry={vi.fn()} />);

    const trigger = screen.getByTestId('history-sheet-trigger');
    expect(trigger.className).toContain('lg:hidden');
    expect(trigger.className).not.toMatch(/\bmd:/);
  });

  it('closing the sheet returns focus to the trigger', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ sessions: [], hasMore: false }));

    renderWithProviders(<HistorySidebar onRetry={vi.fn()} />);

    const trigger = screen.getByTestId('history-sheet-trigger');
    trigger.focus();
    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByTestId('history-sidebar-sheet')).toBeInTheDocument());

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
