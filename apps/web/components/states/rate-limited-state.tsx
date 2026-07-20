'use client';

import { useEffect, useState } from 'react';

interface RateLimitedStateProps {
  /** Retry-After seconds, as emitted by the backend. */
  readonly retryAfterSeconds: number;
  /** Fired exactly once when the countdown reaches zero. */
  readonly onElapsed: () => void;
  readonly testIdPrefix?: string;
}

/**
 * RateLimitedState — 429 surface with countdown (Story 2.7 AC #10).
 *
 * Shows the canonical "You're going a bit fast. Try again in {n} seconds."
 * copy and calls `onElapsed` exactly once when the countdown reaches zero.
 * The caller is expected to use that callback to re-enable the Start button
 * — we never call back into any mutation here, because rate-limit reset
 * belongs to the parent's transition logic.
 *
 * Honoring `prefers-reduced-motion` is delegated to globals.css; the
 * countdown number is information, not decoration, so it always advances.
 */
export function RateLimitedState({
  retryAfterSeconds,
  onElapsed,
  testIdPrefix = 'rate-limited',
}: RateLimitedStateProps): React.JSX.Element {
  const [remaining, setRemaining] = useState<number>(Math.max(0, retryAfterSeconds));

  useEffect(() => {
    setRemaining(Math.max(0, retryAfterSeconds));
  }, [retryAfterSeconds]);

  useEffect(() => {
    if (remaining <= 0) {
      onElapsed();
      return;
    }
    const t = setTimeout(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining, onElapsed]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`${testIdPrefix}-root`}
      className="rounded-md border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] p-6"
    >
      <p
        data-testid={`${testIdPrefix}-message`}
        className="text-[length:var(--text-reading)] text-[var(--color-ink)]"
      >
        You are going a bit fast. Try again in {remaining} second{remaining === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
