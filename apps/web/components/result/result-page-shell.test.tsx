import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SubmittedSessionDetail } from '../../lib/types';
import { ResultPageShell } from './result-page-shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const SUBMITTED_SESSION: SubmittedSessionDetail = {
  sessionId: SESSION_ID,
  status: 'submitted',
  finalScore: 3,
  breakdown: [],
  categoryBreakdown: [],
  questions: [],
};

function renderWithProviders(ui: React.ReactNode): ReturnType<typeof render> {
  // ChatPanel (Story 4.3), mounted inside ChatPanelSlot, calls
  // useChatHistoryQuery — every render of ResultPageShell now needs a
  // QueryClientProvider ancestor.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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

  // ChatPanel's history fetch degrades gracefully on error (the chat
  // backend, Story 4.1, does not exist yet) — reject fast rather than
  // letting jsdom attempt a real network call to localhost:3001.
  globalThis.fetch = (async () => {
    throw new Error('chat backend not available in this test');
  }) as typeof fetch;
});

describe('ResultPageShell — single-mount responsive pattern', () => {
  it('mounts the results panel and the chat slot exactly once each', () => {
    renderWithProviders(<ResultPageShell sessionId={SESSION_ID} session={SUBMITTED_SESSION} />);

    expect(screen.getAllByTestId('results-panel')).toHaveLength(1);
    expect(screen.getAllByTestId('chat-panel-slot')).toHaveLength(1);
  });

  it('defaults to the Results tab active, Chat inactive', () => {
    renderWithProviders(<ResultPageShell sessionId={SESSION_ID} session={SUBMITTED_SESSION} />);

    expect(screen.getByTestId('result-tab-results')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('result-tab-chat')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('results-panel').closest('[role="tabpanel"]')).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(screen.getByTestId('chat-panel-slot').closest('[role="tabpanel"]')).toHaveAttribute(
      'data-state',
      'inactive',
    );
  });

  it('switches the active tab on click without unmounting either panel', async () => {
    renderWithProviders(<ResultPageShell sessionId={SESSION_ID} session={SUBMITTED_SESSION} />);

    await userEvent.click(screen.getByTestId('result-tab-chat'));

    expect(screen.getByTestId('result-tab-chat')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('chat-panel-slot').closest('[role="tabpanel"]')).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(screen.getByTestId('results-panel').closest('[role="tabpanel"]')).toHaveAttribute(
      'data-state',
      'inactive',
    );
    // Still exactly one of each — a tab switch never re-mounts a subtree.
    expect(screen.getAllByTestId('results-panel')).toHaveLength(1);
    expect(screen.getAllByTestId('chat-panel-slot')).toHaveLength(1);
  });

  it('passes sessionId through to the chat panel slot', () => {
    renderWithProviders(<ResultPageShell sessionId={SESSION_ID} session={SUBMITTED_SESSION} />);
    expect(screen.getByTestId('chat-panel-slot')).toHaveAttribute('data-session-id', SESSION_ID);
  });
});
