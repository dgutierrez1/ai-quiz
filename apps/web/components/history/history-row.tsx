'use client';

import Link from 'next/link';

import type { SessionSummaryDto } from '../../lib/api';

interface HistoryRowProps {
  readonly session: SessionSummaryDto;
  /** Fired for `failed` rows only — prefills the landing form, never re-POSTs. */
  readonly onRetry: (sourceUrl: string) => void;
}

const STATUS_LABEL: Record<SessionSummaryDto['status'], string> = {
  pending: 'Generating',
  ready: 'Ready',
  submitted: 'Completed',
  failed: 'Failed',
};

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function targetHrefFor(session: SessionSummaryDto): string | null {
  if (session.status === 'submitted') return `/result/${session.id}`;
  if (session.status === 'pending' || session.status === 'ready') return `/quiz/${session.id}`;
  return null;
}

/**
 * FailedIcon — a plain circle-exclamation glyph, never a red/destructive
 * treatment (DESIGN.md's no-red rule). Rendered alongside the "Failed"
 * text label, never as the sole carrier of the status.
 */
function FailedIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" className="shrink-0">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.75v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.1" r="0.85" fill="currentColor" />
    </svg>
  );
}

const ROW_CLASSES =
  'flex min-h-[44px] w-full flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] px-4 py-3 text-left transition-colors md:flex-row md:items-center md:gap-3';

/**
 * HistoryRow (Story 5.1 Task 5) — one session in the history list.
 *
 * `submitted` and `pending`/`ready` rows are whole-row navigation controls
 * (`next/link`, per AC #4/#5). `failed` rows never navigate (AC #6); they
 * render a non-navigating error indicator (icon + text, never bare red)
 * plus a separate retry button that prefills the landing form via
 * `onRetry` — it does not auto-resubmit.
 *
 * Below `md` (768px, non-structural — independent of the `lg` sidebar/sheet
 * collapse) the row's own fields stack vertically instead of inline.
 */
export function HistoryRow({ session, onRetry }: HistoryRowProps): React.JSX.Element {
  const href = targetHrefFor(session);
  const created = formatCreatedAt(session.createdAt);
  const isFailed = session.status === 'failed';

  const fields = (
    <div className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4">
      <span
        className="truncate text-sm text-[var(--color-ink)]"
        title={session.sourceUrl}
        data-testid={`history-row-url-${session.id}`}
      >
        {session.sourceUrl}
      </span>
      <div className="flex shrink-0 items-center gap-2 text-xs md:justify-end">
        <span
          data-testid={`history-row-status-${session.id}`}
          className={[
            'inline-flex items-center gap-1 font-medium',
            isFailed ? 'text-[var(--color-strength-weak)]' : 'text-[var(--color-ink-muted)]',
          ].join(' ')}
        >
          {isFailed && <FailedIcon />}
          {STATUS_LABEL[session.status]}
        </span>
        <time dateTime={session.createdAt} className="text-[var(--color-ink-muted)]">
          {created}
        </time>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} data-testid={`history-row-${session.id}`} className={ROW_CLASSES}>
        {fields}
      </Link>
    );
  }

  return (
    <div data-testid={`history-row-${session.id}`} className={ROW_CLASSES}>
      {fields}
      <button
        type="button"
        data-testid={`history-row-retry-${session.id}`}
        onClick={() => onRetry(session.sourceUrl)}
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-surface-sunken)] px-3 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"
      >
        Retry
      </button>
    </div>
  );
}
