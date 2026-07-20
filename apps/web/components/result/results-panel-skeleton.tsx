import { Skeleton } from '../ui/skeleton';

/**
 * ResultsPanelSkeleton (Story 3.2 Task 5) — loading placeholder for score,
 * chips, and breakdown. Never a blank page, never a bare spinner (AC #3).
 */
export function ResultsPanelSkeleton(): React.JSX.Element {
  return (
    <div
      data-testid="results-panel-skeleton"
      role="status"
      aria-live="polite"
      className="flex flex-col gap-6"
    >
      <span className="sr-only">Loading your results.</span>
      <Skeleton className="h-14 w-40" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24 rounded-[var(--radius-full)]" />
        <Skeleton className="h-8 w-24 rounded-[var(--radius-full)]" />
        <Skeleton className="h-8 w-24 rounded-[var(--radius-full)]" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
