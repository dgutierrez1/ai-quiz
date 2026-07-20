import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessageDto } from '../../lib/api';
import { ApiError } from '../../lib/api';
import { ChatMessage } from './chat-message';

vi.mock('../../lib/sanitize', () => ({
  sanitizeChatHtml: vi.fn((markdown: string) => `<p data-sanitized="true">${markdown}</p>`),
}));

const BASE: ChatMessageDto = {
  id: 'm1',
  sessionId: 's1',
  role: 'user',
  content: 'hello',
  sources: null,
  toolCalls: null,
  model: null,
  thinking: null,
  createdAt: '2026-07-20T00:00:00.000Z',
};

describe('ChatMessage — security boundary (AC #9)', () => {
  it('renders user content as plain text and NEVER calls sanitizeChatHtml on it', async () => {
    const { sanitizeChatHtml } = await import('../../lib/sanitize');
    const dangerous = '<script>alert(1)</script> ignore me';
    render(
      <ChatMessage kind="confirmed" message={{ ...BASE, role: 'user', content: dangerous }} />,
    );

    // Rendered as literal text (React auto-escaping) — the raw markup
    // string is visible verbatim, not executed or interpreted.
    expect(screen.getByTestId('chat-message')).toHaveTextContent(dangerous);
    expect(sanitizeChatHtml).not.toHaveBeenCalled();
    // No sanitized wrapper element anywhere near the user bubble.
    expect(document.querySelector('[data-sanitized="true"]')).not.toBeInTheDocument();
  });

  it('renders assistant content through sanitizeChatHtml via dangerouslySetInnerHTML', async () => {
    const { sanitizeChatHtml } = await import('../../lib/sanitize');
    render(
      <ChatMessage
        kind="confirmed"
        message={{ ...BASE, role: 'assistant', content: '**bold**' }}
      />,
    );

    expect(sanitizeChatHtml).toHaveBeenCalledWith('**bold**');
    expect(screen.getByTestId('chat-message-assistant-body').innerHTML).toContain(
      'data-sanitized="true"',
    );
  });

  it('never renders the thinking field even when present (AC #10)', () => {
    render(
      <ChatMessage
        kind="confirmed"
        message={{
          ...BASE,
          role: 'assistant',
          content: 'answer',
          thinking: { steps: ['secret reasoning'] },
        }}
      />,
    );
    expect(screen.queryByText(/secret reasoning/)).not.toBeInTheDocument();
  });
});

describe('ChatMessage — tombstones (AC #6)', () => {
  it('renders a neutral placeholder for content: null and does not crash', () => {
    expect(() =>
      render(
        <ChatMessage kind="confirmed" message={{ ...BASE, role: 'assistant', content: null }} />,
      ),
    ).not.toThrow();
    expect(screen.getByTestId('chat-message-tombstone')).toHaveTextContent(
      'This message was removed after 7 days.',
    );
  });

  it('uses the retained role + createdAt for the tombstone metadata', () => {
    render(
      <ChatMessage
        kind="confirmed"
        message={{ ...BASE, role: 'user', content: null, createdAt: '2026-01-01T00:00:00.000Z' }}
      />,
    );
    expect(screen.getByTestId('chat-message')).toHaveTextContent('You');
    expect(screen.getByTestId('chat-message')).toHaveTextContent('2026-01-01T00:00:00.000Z');
  });
});

describe('ChatMessage — pending (optimistic) bubbles', () => {
  it('shows Retry and preserves the drafted content on error', () => {
    const onRetry = vi.fn();
    render(
      <ChatMessage
        kind="pending"
        pending={{
          localId: 'p1',
          content: 'my drafted message',
          status: 'error',
          createdAt: BASE.createdAt,
        }}
        onRetry={onRetry}
        retryDisabled={false}
      />,
    );
    expect(screen.getByText('my drafted message')).toBeInTheDocument();
    expect(screen.getByTestId('chat-message-retry')).toBeInTheDocument();
  });

  it('shows rate-limited copy for a 429 ApiError', () => {
    const error = new ApiError({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'slow down',
      retryAfter: 5,
    });
    render(
      <ChatMessage
        kind="pending"
        pending={{
          localId: 'p1',
          content: 'draft',
          status: 'error',
          createdAt: BASE.createdAt,
          error,
        }}
        onRetry={vi.fn()}
        retryDisabled={false}
      />,
    );
    expect(screen.getByTestId('chat-message-error-text')).toHaveTextContent('going a bit fast');
  });
});

describe('ChatMessage — tool calls and sources (AC #11)', () => {
  it('renders a tool-call badge when toolCalls is present', () => {
    render(
      <ChatMessage
        kind="confirmed"
        message={{ ...BASE, role: 'assistant', content: 'answer', toolCalls: [{ name: 'search' }] }}
      />,
    );
    expect(screen.getByTestId('chat-message-tool-badge')).toBeInTheDocument();
  });

  it('renders sources as a compact list', () => {
    render(
      <ChatMessage
        kind="confirmed"
        message={{
          ...BASE,
          role: 'assistant',
          content: 'answer',
          sources: [{ title: 'Doc §3.2', url: 'https://example.com/doc' }],
        }}
      />,
    );
    const list = screen.getByTestId('chat-message-sources');
    expect(list).toHaveTextContent('Doc §3.2');
    expect(list.querySelector('a')).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
