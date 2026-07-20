import { ChatPanel } from './chat-panel';

interface ChatPanelSlotProps {
  readonly sessionId: string;
  /** Threaded through to `ChatPanel` — set by the shell on ExplainQuestionButton. */
  readonly pendingPrefill?: string | null;
  readonly onPrefillConsumed?: () => void;
}

/**
 * ChatPanelSlot — the Epic 4 mount seam (Story 3.2 AC #10, Dev Notes →
 * "Chat mount seam").
 *
 * Story 4.3 rewrites this file's internals: the outer `<aside>` keeps its
 * exact `chat-panel-slot` testid and `data-session-id` attribute (the
 * single-mount E2E guardrail asserts on both), but now mounts the real
 * `ChatPanel` rather than a disabled placeholder.
 */
export function ChatPanelSlot({
  sessionId,
  pendingPrefill,
  onPrefillConsumed,
}: ChatPanelSlotProps): React.JSX.Element {
  return (
    <aside
      data-testid="chat-panel-slot"
      aria-label="Chat"
      data-session-id={sessionId}
      className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] p-[var(--spacing-card-padding)]"
    >
      <ChatPanel
        sessionId={sessionId}
        pendingPrefill={pendingPrefill}
        onPrefillConsumed={onPrefillConsumed}
      />
    </aside>
  );
}
