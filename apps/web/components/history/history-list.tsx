'use client';

import { useMemo } from 'react';

import { useSessionsInfiniteQuery } from '../../lib/queries';
import { EmptyState } from '../states/empty-state';
import { ErrorState } from '../states/error-state';
import { HistoryRow } from './history-row';
import { HistoryRowSkeleton } from './history-row-skeleton';

interface HistoryListProps {
  readonly onRetry: (sourceUrl: string) => void;
}

const SKELETON_COUNT = 4;

/**
 * HistoryList (Story 5.1 Task 5) — the sidebar's data-bound content.
 *
 * Exactly ONE `data-testid="history-list"` element is the outer wrapper
 * for every branch below (loading/error/empty/populated) — `HistorySidebar`
 * is what guarantees this component itself is mounted in only one of the
 * aside/sheet locations at a time (see its own doc comment); this
 * component doesn't need to know about that split at all.
 */
export function HistoryList({ onRetry }: HistoryListProps): React.JSX.Element {
  const query = useSessionsInfiniteQuery();

  const sessions = useMemo(
    () => query.data?.pages.flatMap((page) => page.sessions) ?? [],
    [query.data],
  );

  const isInitialLoading = query.isLoading;
  const isEmpty = !isInitialLoading && !query.isError && sessions.length === 0;
  const isPopulated = !isInitialLoading && !query.isError && sessions.length > 0;

  return (
    <div data-testid="history-list" className="flex flex-col gap-3">
      {isInitialLoading && (
        <ul className="flex flex-col gap-2" aria-label="Loading session history">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <li key={index}>
              <HistoryRowSkeleton />
            </li>
          ))}
        </ul>
      )}

      {!isInitialLoading && query.isError && (
        <ErrorState
          testIdPrefix="history-error"
          copy={{
            title: 'History did not load.',
            body: 'Something went wrong loading your past sessions.',
          }}
          onRetry={() => void query.refetch()}
        />
      )}

      {isEmpty && (
        <div data-testid="empty-history-state">
          <EmptyState
            testIdPrefix="history-empty"
            title="No sessions yet."
            body="Sessions are saved to this browser. There's no account to sign in to."
          />
        </div>
      )}

      {isPopulated && (
        <>
          <ul className="flex flex-col gap-2">
            {sessions.map((session) => (
              <li key={session.id}>
                <HistoryRow session={session} onRetry={onRetry} />
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <button
              type="button"
              data-testid="history-load-more"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="inline-flex min-h-[44px] items-center justify-center self-center rounded-[var(--radius-md)] border border-[var(--color-surface-sunken)] px-4 text-sm font-medium text-[var(--color-ink)] disabled:opacity-50"
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
