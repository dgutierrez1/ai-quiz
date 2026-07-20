'use client';

import { useLayoutEffect, useRef } from 'react';

import type { ChatMessageDto } from '../../lib/api';
import { ChatMessage, type PendingChatMessage } from './chat-message';

interface ChatThreadProps {
  /** Oldest -> newest, confirmed messages only. */
  readonly messages: readonly ChatMessageDto[];
  /** Optimistic (sending/error) user messages, appended after `messages`. */
  readonly pending: readonly PendingChatMessage[];
  readonly onRetry: (localId: string) => void;
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  readonly onViewOlder: () => void;
  readonly isSending: boolean;
}

/**
 * ChatThread (Story 4.3 Task 4) — `role="log"` container. `aria-live` +
 * `aria-relevant="additions"` so incoming assistant turns are announced
 * without re-announcing scrollback on mount or "view older" (AC #13).
 *
 * "View older" anchors scroll to the previously-topmost message rather
 * than letting the newly prepended batch yank the viewport — measured by
 * comparing `scrollHeight` before/after the prepend and restoring the
 * delta (EXPERIENCE.md § Component Patterns → Chat thread).
 */
export function ChatThread({
  messages,
  pending,
  onRetry,
  hasOlder,
  isLoadingOlder,
  onViewOlder,
  isSending,
}: ChatThreadProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    const delta = el.scrollHeight - anchor.scrollHeight;
    el.scrollTop = anchor.scrollTop + delta;
    anchorRef.current = null;
    // Intentionally keyed on `messages` only — re-anchoring should fire
    // when the message set itself changes (a new older batch prepended),
    // not on every render.
  }, [messages]);

  const handleViewOlder = (): void => {
    const el = scrollRef.current;
    if (el) {
      anchorRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    }
    onViewOlder();
  };

  const isTyping = pending.some((p) => p.status === 'sending');

  return (
    <div
      ref={scrollRef}
      data-testid="chat-thread"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      className="flex max-h-[60vh] min-h-[240px] flex-col gap-3 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] p-[var(--spacing-card-padding)]"
    >
      {hasOlder && (
        <button
          type="button"
          data-testid="chat-view-older"
          onClick={handleViewOlder}
          disabled={isLoadingOlder}
          className="mx-auto min-h-[44px] rounded-[var(--radius-sm)] px-3 text-sm font-medium text-[var(--color-primary)] underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoadingOlder ? 'Loading…' : 'View older'}
        </button>
      )}

      {messages.map((message) => (
        <ChatMessage key={message.id} kind="confirmed" message={message} />
      ))}

      {pending.map((p) => (
        <ChatMessage
          key={p.localId}
          kind="pending"
          pending={p}
          onRetry={onRetry}
          retryDisabled={isSending}
        />
      ))}

      {isTyping && (
        <p
          data-testid="chat-typing-indicator"
          className="text-[length:var(--text-reading)] text-[var(--color-ink-muted)]"
        >
          Thinking…
        </p>
      )}
    </div>
  );
}
