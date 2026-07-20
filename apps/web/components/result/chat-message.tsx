import type { ChatMessageDto } from '../../lib/api';
import { ApiError } from '../../lib/api';
import { chatSendErrorCopy } from '../../lib/error-copy';
import { sanitizeChatHtml } from '../../lib/sanitize';

/**
 * An optimistic, not-yet-confirmed user message (Story 4.3 Task 3/4). Lives
 * in `ChatPanel`'s local state, never in the TanStack Query cache — see
 * `lib/queries.ts`'s `useSendChatMessageMutation` doc comment for why.
 */
export interface PendingChatMessage {
  readonly localId: string;
  readonly content: string;
  readonly status: 'sending' | 'error';
  readonly createdAt: string;
  readonly error?: unknown;
}

interface ConfirmedMessageProps {
  readonly kind: 'confirmed';
  readonly message: ChatMessageDto;
}

interface PendingMessageProps {
  readonly kind: 'pending';
  readonly pending: PendingChatMessage;
  readonly onRetry: (localId: string) => void;
  readonly retryDisabled: boolean;
}

type ChatMessageProps = ConfirmedMessageProps | PendingMessageProps;

const USER_BUBBLE_CLASS =
  'ml-auto max-w-[80%] rounded-[var(--radius-lg)] bg-[var(--color-surface-sunken)] px-4 py-3 text-[length:var(--text-reading)] text-[var(--color-ink)] whitespace-pre-wrap [overflow-wrap:anywhere]';

const ASSISTANT_WRAPPER_CLASS =
  'w-full max-w-[var(--spacing-reading-measure)] text-[length:var(--text-reading)] text-[var(--color-ink)]';

const ASSISTANT_PROSE_CLASS =
  '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_a]:text-[var(--color-primary)] [&_a]:underline [&_code]:font-mono [&_code]:text-[length:var(--text-code)] ' +
  '[&_pre]:font-mono [&_pre]:text-[length:var(--text-code)] [&_pre]:overflow-x-auto [&_pre]:rounded-[var(--radius-md)] ' +
  '[&_pre]:bg-[var(--color-surface-sunken)] [&_pre]:p-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-surface-sunken)] ' +
  '[&_blockquote]:pl-3 [&_blockquote]:text-[var(--color-ink-muted)] [&_table]:my-2 [&_th]:border [&_th]:border-[var(--color-surface-sunken)] ' +
  '[&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-[var(--color-surface-sunken)] [&_td]:px-2 [&_td]:py-1';

function isSafeHref(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function TombstoneMessage({ message }: { readonly message: ChatMessageDto }): React.JSX.Element {
  const isUser = message.role === 'user';
  return (
    <div
      data-testid="chat-message"
      data-role={message.role}
      data-status="tombstoned"
      className={isUser ? USER_BUBBLE_CLASS : ASSISTANT_WRAPPER_CLASS}
    >
      <p data-testid="chat-message-tombstone" className="italic text-[var(--color-ink-muted)]">
        This message was removed after 7 days.
      </p>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        {isUser ? 'You' : 'Assistant'} ·{' '}
        <time dateTime={message.createdAt}>{message.createdAt}</time>
      </p>
    </div>
  );
}

function ConfirmedMessage({ message }: { readonly message: ChatMessageDto }): React.JSX.Element {
  if (message.content === null) {
    return <TombstoneMessage message={message} />;
  }

  if (message.role === 'user') {
    // Plain text only — user content NEVER passes through sanitizeChatHtml
    // or dangerouslySetInnerHTML (AC #9, AD-N1). `{message.content}` alone
    // is the entire rendering path.
    return (
      <div data-testid="chat-message" data-role="user" className={USER_BUBBLE_CLASS}>
        {message.content}
      </div>
    );
  }

  // Assistant content is markdown -> sanitized HTML. `thinking` is
  // intentionally never read here (AC #10).
  const html = sanitizeChatHtml(message.content);
  const toolCalls = message.toolCalls ?? [];
  const sources = message.sources ?? [];

  return (
    <div data-testid="chat-message" data-role="assistant" className={ASSISTANT_WRAPPER_CLASS}>
      <div
        data-testid="chat-message-assistant-body"
        className={ASSISTANT_PROSE_CLASS}
        // Scoped exclusively to sanitized assistant HTML (AD-N1) — never
        // used for user or question/answer content anywhere in this file.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {toolCalls.length > 0 && (
        <span
          data-testid="chat-message-tool-badge"
          className="mt-2 inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]"
        >
          Used a tool
        </span>
      )}
      {sources.length > 0 && (
        <ul
          data-testid="chat-message-sources"
          className="mt-2 flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]"
        >
          {sources.map((source, i) => (
            <li key={`${source.url}-${i}`}>
              {isSafeHref(source.url) ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {source.title}
                </a>
              ) : (
                <span>{source.title}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PendingMessage({
  pending,
  onRetry,
  retryDisabled,
}: {
  readonly pending: PendingChatMessage;
  readonly onRetry: (localId: string) => void;
  readonly retryDisabled: boolean;
}): React.JSX.Element {
  const copy = pending.status === 'error' ? chatSendErrorCopy(pending.error) : undefined;
  const isRateLimited = pending.error instanceof ApiError && pending.error.status === 429;

  return (
    <div
      data-testid="chat-message"
      data-role="user"
      data-status={pending.status}
      className={USER_BUBBLE_CLASS}
    >
      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{pending.content}</p>
      {pending.status === 'error' && copy && (
        <div className="mt-2 flex flex-col items-end gap-1">
          <p
            data-testid="chat-message-error-text"
            className="text-xs text-[var(--color-ink-muted)]"
          >
            {isRateLimited ? "You're going a bit fast." : `${copy.title} ${copy.body}`}
          </p>
          <button
            type="button"
            data-testid="chat-message-retry"
            onClick={() => onRetry(pending.localId)}
            disabled={retryDisabled}
            className="min-h-[44px] rounded-[var(--radius-sm)] px-3 text-sm font-medium text-[var(--color-primary)] underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatMessage(props: ChatMessageProps): React.JSX.Element {
  if (props.kind === 'pending') {
    return (
      <PendingMessage
        pending={props.pending}
        onRetry={props.onRetry}
        retryDisabled={props.retryDisabled}
      />
    );
  }
  return <ConfirmedMessage message={props.message} />;
}
