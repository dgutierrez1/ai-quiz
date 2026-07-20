interface EmptyStateProps {
  readonly title: string;
  readonly body: string;
  readonly testIdPrefix?: string;
}

/**
 * EmptyState — generic empty shell (Story 2.7 AC #11).
 *
 * Used here for "no providers configured" — Story 5.1 reuses it for the
 * empty history sidebar. Visual is intentionally restrained: there is no
 * decoration, no CTA, no illustration. The copy carries the entire
 * message.
 */
export function EmptyState({
  title,
  body,
  testIdPrefix = 'empty',
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      role="status"
      data-testid={`${testIdPrefix}-root`}
      className="rounded-md border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] p-6"
    >
      <h2
        data-testid={`${testIdPrefix}-title`}
        className="font-display text-[length:var(--text-question)] text-[var(--color-ink)]"
      >
        {title}
      </h2>
      <p
        data-testid={`${testIdPrefix}-body`}
        className="mt-2 text-[length:var(--text-reading)] text-[var(--color-ink-muted)]"
      >
        {body}
      </p>
    </div>
  );
}
