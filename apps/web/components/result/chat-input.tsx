'use client';

import { forwardRef } from 'react';

const MAX_LENGTH = 8000;

interface ChatInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: (content: string) => void;
  readonly disabled: boolean;
  readonly describedBy?: string;
}

/**
 * ChatInput (Story 4.3 Task 5) — textarea + send button.
 *
 * `Enter` sends (non-empty, not disabled); `Shift+Enter` inserts a newline
 * (default textarea behavior — no `preventDefault`) per AC #13. Stays
 * `sticky bottom-0` inside the scrolling panel so it clears the on-screen
 * keyboard on mobile without any JS viewport/keyboard detection.
 *
 * Forwards its ref to the underlying `<textarea>` so `ChatPanel` can
 * imperatively focus it and place the caret at the end when the "Explain
 * Qn" prefill lands (EXPERIENCE.md: "moves focus to the chat input").
 */
export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(function ChatInput(
  { value, onChange, onSend, disabled, describedBy },
  ref,
) {
  const trimmed = value.trim();
  const canSend = !disabled && trimmed.length > 0;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend(trimmed);
      }
    }
  };

  const handleSendClick = (): void => {
    if (canSend) {
      onSend(trimmed);
    }
  };

  return (
    <div
      data-testid="chat-input-row"
      className="sticky bottom-0 flex items-end gap-2 border-t border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] pt-3"
    >
      <label htmlFor="chat-input-textarea" className="sr-only">
        Message
      </label>
      <textarea
        id="chat-input-textarea"
        ref={ref}
        data-testid="chat-input"
        value={value}
        maxLength={MAX_LENGTH}
        disabled={disabled}
        aria-label="Message"
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        className="min-h-[44px] flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-base)] p-2 text-[length:var(--text-reading)] text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="button"
        data-testid="chat-send"
        onClick={handleSendClick}
        disabled={!canSend}
        className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-[var(--color-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Send
      </button>
    </div>
  );
});
