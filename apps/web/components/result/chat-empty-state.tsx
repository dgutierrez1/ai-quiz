interface ChatEmptyStateProps {
  readonly onQuickAction: (content: string) => void;
  readonly disabled?: boolean;
}

/**
 * ChatEmptyState (Story 4.3 Task 5, AC #3) — framing line + two
 * quick-action chips that send immediately on click.
 *
 * "Where am I weakest?" is deliberately substituted for EXPERIENCE.md's
 * illustrative "Explain Q1" example (Open Item #6): both chips must be
 * answerable purely from `insights` already loaded into the chat LLM's
 * server-side context (AC #8) — a per-question chip would require
 * `ChatPanel` to reach into Story 3.2's breakdown data, which would blur
 * the mount-boundary this component is supposed to keep clean.
 *
 * Not a fork of the generic `EmptyState` — that component has no slot for
 * chips, and the framing copy here follows EXPERIENCE.md's voice (second
 * person, present tense, no exclamation marks).
 */
export function ChatEmptyState({
  onQuickAction,
  disabled = false,
}: ChatEmptyStateProps): React.JSX.Element {
  return (
    <div
      data-testid="chat-empty-state"
      className="flex flex-col items-center gap-4 py-10 text-center text-[length:var(--text-reading)] text-[var(--color-ink-muted)]"
    >
      <p>Ask about the document, or start with one of these.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          data-testid="chat-quick-action-study-next"
          onClick={() => onQuickAction('What should I study next?')}
          disabled={disabled}
          className="min-h-[44px] rounded-[var(--radius-full)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] px-4 text-sm font-medium text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          What should I study next?
        </button>
        <button
          type="button"
          data-testid="chat-quick-action-weakest"
          onClick={() => onQuickAction('Where am I weakest?')}
          disabled={disabled}
          className="min-h-[44px] rounded-[var(--radius-full)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] px-4 text-sm font-medium text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Where am I weakest?
        </button>
      </div>
    </div>
  );
}
