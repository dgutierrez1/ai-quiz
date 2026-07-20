import { Skeleton } from '../ui/skeleton';

/**
 * HistoryRowSkeleton (Story 5.1 Task 5) — loading placeholder for one
 * `HistoryList` row, shown while `useSessionsInfiniteQuery()`'s first page
 * is in flight. Mirrors `HistoryRow`'s outer shape (source URL + status/date
 * cluster) so the skeleton-to-populated swap doesn't shift layout.
 */
export function HistoryRowSkeleton(): React.JSX.Element {
  return (
    <div
      data-testid="history-row-skeleton"
      className="flex min-h-[44px] flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] px-4 py-3 md:flex-row md:items-center md:justify-between"
    >
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-20" />
    </div>
  );
}
