import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SessionSummaryDto } from '../../lib/api';
import { HistoryRow } from './history-row';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function session(overrides: Partial<SessionSummaryDto> = {}): SessionSummaryDto {
  return {
    id: SESSION_ID,
    sourceUrl: 'https://example.com/article.md',
    status: 'submitted',
    createdAt: '2026-07-15T09:00:00.000Z',
    ...overrides,
  };
}

describe('HistoryRow — routing by status (AC #4, #5, #6)', () => {
  it('renders a submitted row as a link to /result/[id]', () => {
    render(<HistoryRow session={session({ status: 'submitted' })} onRetry={vi.fn()} />);

    const row = screen.getByTestId(`history-row-${SESSION_ID}`);
    expect(row.tagName).toBe('A');
    expect(row).toHaveAttribute('href', `/result/${SESSION_ID}`);
  });

  it('renders a ready row as a link to /quiz/[id]', () => {
    render(<HistoryRow session={session({ status: 'ready' })} onRetry={vi.fn()} />);

    const row = screen.getByTestId(`history-row-${SESSION_ID}`);
    expect(row.tagName).toBe('A');
    expect(row).toHaveAttribute('href', `/quiz/${SESSION_ID}`);
  });

  it('renders a pending row as a link to /quiz/[id]', () => {
    render(<HistoryRow session={session({ status: 'pending' })} onRetry={vi.fn()} />);

    const row = screen.getByTestId(`history-row-${SESSION_ID}`);
    expect(row.tagName).toBe('A');
    expect(row).toHaveAttribute('href', `/quiz/${SESSION_ID}`);
  });

  it('renders a failed row as a non-navigating container with a retry button, never a link', async () => {
    const onRetry = vi.fn();
    render(
      <HistoryRow
        session={session({ status: 'failed', sourceUrl: 'https://example.com/broken.md' })}
        onRetry={onRetry}
      />,
    );

    const row = screen.getByTestId(`history-row-${SESSION_ID}`);
    expect(row.tagName).not.toBe('A');
    expect(row).not.toHaveAttribute('href');

    const retryButton = screen.getByTestId(`history-row-retry-${SESSION_ID}`);
    await userEvent.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith('https://example.com/broken.md');
  });

  it('never renders the failed status in a destructive/red className token', () => {
    render(<HistoryRow session={session({ status: 'failed' })} onRetry={vi.fn()} />);

    const status = screen.getByTestId(`history-row-status-${SESSION_ID}`);
    expect(status.className).not.toMatch(/destructive|red/i);
    expect(status).toHaveTextContent('Failed');
  });
});
