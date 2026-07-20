import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChatInput } from './chat-input';

function ControlledChatInput({
  onSend,
  disabled = false,
}: {
  readonly onSend: (content: string) => void;
  readonly disabled?: boolean;
}): React.JSX.Element {
  const [value, setValue] = useState('');
  return <ChatInput value={value} onChange={setValue} onSend={onSend} disabled={disabled} />;
}

describe('ChatInput — keyboard handling (AC #13)', () => {
  it('Enter sends when non-empty and not disabled', async () => {
    const onSend = vi.fn();
    render(<ControlledChatInput onSend={onSend} />);

    const textarea = screen.getByTestId('chat-input');
    await userEvent.type(textarea, 'hello there{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hello there');
  });

  it('Shift+Enter inserts a newline instead of sending', async () => {
    const onSend = vi.fn();
    render(<ControlledChatInput onSend={onSend} />);

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    await userEvent.type(textarea, 'line one{Shift>}{Enter}{/Shift}line two');

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe('line one\nline two');
  });

  it('Enter does nothing when the input is empty', async () => {
    const onSend = vi.fn();
    render(<ControlledChatInput onSend={onSend} />);

    await userEvent.type(screen.getByTestId('chat-input'), '{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('the send button is disabled while disabled=true, even with content', () => {
    render(<ChatInput value="hello" onChange={vi.fn()} onSend={vi.fn()} disabled={true} />);
    expect(screen.getByTestId('chat-send')).toBeDisabled();
    expect(screen.getByTestId('chat-input')).toBeDisabled();
  });

  it('the send button is disabled when the input is empty/whitespace-only', () => {
    render(<ChatInput value="   " onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    expect(screen.getByTestId('chat-send')).toBeDisabled();
  });

  it('clicking Send fires onSend with the trimmed value', async () => {
    const onSend = vi.fn();
    render(<ChatInput value="  hi  " onChange={vi.fn()} onSend={onSend} disabled={false} />);
    await userEvent.click(screen.getByTestId('chat-send'));
    expect(onSend).toHaveBeenCalledWith('hi');
  });
});
