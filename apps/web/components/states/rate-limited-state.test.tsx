import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitedState } from './rate-limited-state';
describe('RateLimitedState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders the canonical copy with the seconds value', () => {
    render(<RateLimitedState retryAfterSeconds={30} onElapsed={() => {}} />);
    expect(screen.getByTestId('rate-limited-message')).toHaveTextContent(/30 seconds/i);
  });

  it('uses singular copy when the value is 1', () => {
    render(<RateLimitedState retryAfterSeconds={1} onElapsed={() => {}} />);
    expect(screen.getByTestId('rate-limited-message')).toHaveTextContent(/1 second\b/);
  });

  it('fires onElapsed exactly once when the countdown reaches zero', () => {
    const onElapsed = vi.fn();
    render(<RateLimitedState retryAfterSeconds={2} onElapsed={onElapsed} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onElapsed).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });
});
