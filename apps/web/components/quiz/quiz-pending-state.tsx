'use client';

import Link from 'next/link';

interface QuizPendingStateProps {
  readonly onRefresh: () => void;
}

/**
 * QuizPendingState (Story 3.3 Task 3, Dev Notes → "The `pending` state is
 * a genuine UX-spec gap").
 *
 * Only reachable via a crashed/abandoned generation attempt resumed later
 * from history (Story 5.1) — `POST /sessions` is synchronous in v1, so the
 * overwhelmingly common path never sees this. No polling per [A-8]'s
 * decision: this is a static message with a manual refresh action
 * (re-runs the `GET /sessions/:id` query) plus a link back to `/`. No
 * spinner — there's no server-side signal backing an "imminent completion"
 * promise.
 *
 * Kept local to this story (not promoted to `components/states/`) per the
 * story's own instruction: no second consumer exists yet.
 */
export function QuizPendingState({ onRefresh }: QuizPendingStateProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="quiz-pending-root"
      className="rounded-[var(--radius-md)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] p-6"
    >
      <h1 className="sr-only">This quiz is still being generated.</h1>
      <p className="text-[length:var(--text-reading)] text-[var(--color-ink)]">
        This quiz is still being generated. Check back in a moment, or start a new one.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          data-testid="quiz-pending-refresh"
          onClick={onRefresh}
          className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 text-[var(--color-primary-foreground)] hover:opacity-90"
        >
          Check again
        </button>
        <Link
          href="/"
          data-testid="quiz-pending-home-link"
          className="text-sm text-[var(--color-primary)] underline"
        >
          Start a new session
        </Link>
      </div>
    </div>
  );
}
