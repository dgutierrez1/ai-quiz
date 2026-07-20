interface ProgressIndicatorProps {
  readonly current: number;
  readonly total: number;
}

/**
 * ProgressIndicator — "{n} of {total}" position tracker (Story 3.3 AC #1,
 * EXPERIENCE.md Interaction Primitives).
 */
export function ProgressIndicator({ current, total }: ProgressIndicatorProps): React.JSX.Element {
  return (
    <p data-testid="position-indicator" className="text-sm text-[var(--color-ink-muted)]">
      {current} of {total}
    </p>
  );
}
