interface ShortfallNoteProps {
  readonly actualCount: number;
  readonly questionCount: number;
}

/**
 * ShortfallNote (Story 3.3 AC #7, EXPERIENCE.md § Trust & Disclosure).
 *
 * Rendered once, above the first question only, when the session's
 * `actualCount` is present and less than the requested `questionCount`.
 * Copy is EXPERIENCE.md's exact template — framed as a document property,
 * never blame.
 */
export function ShortfallNote({
  actualCount,
  questionCount,
}: ShortfallNoteProps): React.JSX.Element {
  return (
    <p
      data-testid="shortfall-note"
      role="status"
      className="rounded-[var(--radius-md)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] p-4 text-sm text-[var(--color-ink-muted)]"
    >
      This document supported <strong className="text-[var(--color-ink)]">{actualCount}</strong>{' '}
      questions rather than {questionCount} — try a longer document if you&apos;d like the full set.
    </p>
  );
}
