'use client';

import type { ErrorCopy } from '../../lib/error-copy';

interface ErrorStateProps {
  readonly copy: ErrorCopy;
  readonly onRetry: () => void;
  readonly testIdPrefix?: string;
}

/**
 * ErrorState — generic error surface with Retry (Story 2.7 AC #9).
 *
 * Renders human copy only (mapped from `error.code` in `error-copy.ts`).
 * The raw code and stack trace are NEVER shown; `requestId` is shown
 * below the body in small print for support, but de-emphasized.
 */
export function ErrorState({
  copy,
  onRetry,
  testIdPrefix = 'error',
}: ErrorStateProps): React.JSX.Element {
  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid={`${testIdPrefix}-root`}
      className="rounded-md border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] p-6"
    >
      <h2
        data-testid={`${testIdPrefix}-title`}
        className="font-display text-[length:var(--text-question)] text-[var(--color-ink)]"
      >
        {copy.title}
      </h2>
      <p
        data-testid={`${testIdPrefix}-body`}
        className="mt-2 text-[length:var(--text-reading)] text-[var(--color-ink-muted)]"
      >
        {copy.body}
      </p>
      <div className="mt-4">
        <button
          type="button"
          data-testid={`${testIdPrefix}-retry`}
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-[var(--color-primary-foreground)] hover:opacity-90"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
