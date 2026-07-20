'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { ApiError, type ChatMessageDto } from '../../lib/api';
import {
  useChatHistoryQuery,
  useLoadOlderChatMutation,
  useSendChatMessageMutation,
} from '../../lib/queries';
import { RateLimitedState } from '../states/rate-limited-state';
import { ChatEmptyState } from './chat-empty-state';
import { ChatInput } from './chat-input';
import type { PendingChatMessage } from './chat-message';
import { ChatThread } from './chat-thread';

export interface ChatPanelProps {
  readonly sessionId: string;
  /** Set by the shell when an ExplainQuestionButton fires. */
  readonly pendingPrefill?: string | null;
  /** Called once ChatPanel has consumed pendingPrefill into its own input state. */
  readonly onPrefillConsumed?: () => void;
}

let localIdCounter = 0;
function nextLocalId(): string {
  localIdCounter += 1;
  return `pending-${localIdCounter}`;
}

// A batch this size or larger implies there may be more history behind it —
// the API contract has no total count, so this is a heuristic, not a fact.
const FULL_BATCH_SIZE = 50;

/**
 * ChatPanel (Story 4.3 Task 7) — composes empty/thread/input states by
 * message count and in-flight status. Fully self-contained: the shell
 * passes only `sessionId` + the lifted prefill props, never reaching into
 * internals (§ Chat slot contract).
 *
 * Message state model: confirmed messages come from three sources merged
 * oldest -> newest — `olderMessages` (prepended via "view older"), the
 * initial `useChatHistoryQuery` batch, and `sentMessages` (this session's
 * own confirmed sends). Optimistic/error bubbles live separately in
 * `pendingMessages` so several can be in an error state at once without
 * corrupting the confirmed thread (AC #5: the drafted text is never
 * silently discarded).
 */
export function ChatPanel({
  sessionId,
  pendingPrefill,
  onPrefillConsumed,
}: ChatPanelProps): React.JSX.Element {
  const prefersReducedMotion = useReducedMotion();
  const historyQuery = useChatHistoryQuery(sessionId);
  const loadOlderMutation = useLoadOlderChatMutation(sessionId);
  const sendMutation = useSendChatMessageMutation(sessionId);

  const [olderMessages, setOlderMessages] = useState<ChatMessageDto[]>([]);
  const [hasOlder, setHasOlder] = useState(true);
  const [sentMessages, setSentMessages] = useState<ChatMessageDto[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [shouldFocusInput, setShouldFocusInput] = useState(false);
  const [rateLimitBanner, setRateLimitBanner] = useState<{ retryAfterSeconds: number } | null>(
    null,
  );

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const onPrefillConsumedRef = useRef(onPrefillConsumed);
  useEffect(() => {
    onPrefillConsumedRef.current = onPrefillConsumed;
  }, [onPrefillConsumed]);

  // Consume pendingPrefill into local input state, purely client-side —
  // no request is ever sent as a side effect of this (AC #7).
  useEffect(() => {
    if (pendingPrefill != null && pendingPrefill.length > 0) {
      setInputValue(pendingPrefill);
      setShouldFocusInput(true);
      onPrefillConsumedRef.current?.();
    }
  }, [pendingPrefill]);

  // Runs after the render that committed the new input value, so the
  // textarea's DOM value already reflects it by the time we focus + place
  // the caret at the end.
  useEffect(() => {
    if (!shouldFocusInput) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
    setShouldFocusInput(false);
  }, [shouldFocusInput]);

  const historyMessages = historyQuery.data?.messages ?? [];
  // A history-fetch error (e.g. the chat backend 404ing pre-Story-4.1) is
  // treated as "no messages yet" rather than a hard failure — degrade
  // gracefully per this story's brief.
  const confirmedMessages: ChatMessageDto[] = [
    ...olderMessages,
    ...historyMessages,
    ...sentMessages,
  ];
  const isSending = pendingMessages.some((m) => m.status === 'sending');
  const isEmpty =
    !historyQuery.isLoading && confirmedMessages.length === 0 && pendingMessages.length === 0;

  const initialBatchFull = historyMessages.length >= FULL_BATCH_SIZE;
  const showViewOlder = hasOlder && (initialBatchFull || olderMessages.length > 0);

  function sendContent(content: string, existingLocalId?: string): void {
    const localId = existingLocalId ?? nextLocalId();
    setPendingMessages((prev) => {
      if (existingLocalId) {
        return prev.map((m) =>
          m.localId === existingLocalId ? { ...m, status: 'sending', error: undefined } : m,
        );
      }
      return [
        ...prev,
        { localId, content, status: 'sending', createdAt: new Date().toISOString() },
      ];
    });

    sendMutation.mutate(
      { content },
      {
        onSuccess: (data) => {
          setPendingMessages((prev) => prev.filter((m) => m.localId !== localId));
          setSentMessages((prev) => [...prev, data.userMessage, data.assistantMessage]);
        },
        onError: (err) => {
          setPendingMessages((prev) =>
            prev.map((m) => (m.localId === localId ? { ...m, status: 'error', error: err } : m)),
          );
          if (err instanceof ApiError && err.status === 429) {
            setRateLimitBanner({ retryAfterSeconds: err.retryAfter ?? 30 });
          }
        },
      },
    );
  }

  const handleSend = (content: string): void => {
    if (isSending) return;
    setInputValue('');
    sendContent(content);
  };

  const handleQuickAction = (content: string): void => {
    if (isSending) return;
    sendContent(content);
  };

  const handleRetry = (localId: string): void => {
    if (isSending) return;
    const target = pendingMessages.find((m) => m.localId === localId);
    if (!target) return;
    sendContent(target.content, localId);
  };

  const handleViewOlder = (): void => {
    if (loadOlderMutation.isPending) return;
    const oldest = confirmedMessages[0]?.createdAt;
    if (!oldest) return;
    loadOlderMutation.mutate(
      { before: oldest },
      {
        onSuccess: (data) => {
          if (data.messages.length === 0) {
            setHasOlder(false);
            return;
          }
          setOlderMessages((prev) => [...data.messages, ...prev]);
        },
      },
    );
  };

  const inputDisabled = isSending || rateLimitBanner !== null;

  return (
    <motion.div
      data-testid="chat-panel"
      initial={prefersReducedMotion ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
      className="flex h-full min-h-[240px] flex-col gap-3"
    >
      {isEmpty ? (
        <ChatEmptyState onQuickAction={handleQuickAction} disabled={isSending} />
      ) : (
        <ChatThread
          messages={confirmedMessages}
          pending={pendingMessages}
          onRetry={handleRetry}
          hasOlder={showViewOlder}
          isLoadingOlder={loadOlderMutation.isPending}
          onViewOlder={handleViewOlder}
          isSending={isSending}
        />
      )}

      {rateLimitBanner && (
        <div id="chat-rate-limited-banner">
          <RateLimitedState
            retryAfterSeconds={rateLimitBanner.retryAfterSeconds}
            onElapsed={() => setRateLimitBanner(null)}
            testIdPrefix="chat-rate-limited"
          />
        </div>
      )}

      <ChatInput
        ref={inputRef}
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        disabled={inputDisabled}
        describedBy={rateLimitBanner ? 'chat-rate-limited-banner' : undefined}
      />
    </motion.div>
  );
}
