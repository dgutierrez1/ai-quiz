import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NarratedWait, type NarratedWaitStage } from './narrated-wait';
const STAGES: readonly NarratedWaitStage[] = [
  { atMs: 0, text: 'Fetching the document…' },
  { atMs: 50, text: 'Reading it through…' },
  { atMs: 150, text: 'Writing your questions…' },
];

describe('NarratedWait', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('shows the first stage on mount', () => {
    render(<NarratedWait stages={STAGES} />);
    expect(screen.getByTestId('wait-stage')).toHaveTextContent(/Fetching/);
  });

  it('advances forward-only and never resets to an earlier stage', () => {
    render(<NarratedWait stages={STAGES} />);
    expect(screen.getByTestId('wait-stage')).toHaveTextContent(/Fetching/);

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByTestId('wait-stage')).toHaveTextContent(/Reading/);

    // Advancing further should not regress.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('wait-stage')).toHaveTextContent(/Writing/);
  });
});
