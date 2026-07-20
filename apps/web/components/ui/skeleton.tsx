interface SkeletonProps {
  readonly className?: string;
  readonly testId?: string;
}

/**
 * Skeleton — generic loading-placeholder primitive (Story 3.2 Task 5).
 *
 * `aria-hidden` because the loading state's accessible name comes from the
 * surrounding `role="status"`/`aria-live` container, not from the
 * placeholder blocks themselves. Honors `prefers-reduced-motion` via the
 * global `@media` rule in `globals.css` (Story 2.7), which zeroes
 * `animation-duration` — no per-component override needed.
 */
export function Skeleton({ className, testId }: SkeletonProps): React.JSX.Element {
  return (
    <div
      data-testid={testId}
      aria-hidden="true"
      className={[
        'animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)]',
        className ?? '',
      ].join(' ')}
    />
  );
}
