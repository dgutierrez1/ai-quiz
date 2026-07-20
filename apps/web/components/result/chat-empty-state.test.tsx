import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatEmptyState } from './chat-empty-state';

describe('ChatEmptyState (AC #3)', () => {
  it('sends immediately when the "What should I study next?" chip is clicked', async () => {
    const onQuickAction = vi.fn();
    render(<ChatEmptyState onQuickAction={onQuickAction} />);
    await userEvent.click(screen.getByTestId('chat-quick-action-study-next'));
    expect(onQuickAction).toHaveBeenCalledWith('What should I study next?');
  });

  it('sends immediately when the "Where am I weakest?" chip is clicked', async () => {
    const onQuickAction = vi.fn();
    render(<ChatEmptyState onQuickAction={onQuickAction} />);
    await userEvent.click(screen.getByTestId('chat-quick-action-weakest'));
    expect(onQuickAction).toHaveBeenCalledWith('Where am I weakest?');
  });

  it('disables both chips while a send is in flight', () => {
    render(<ChatEmptyState onQuickAction={vi.fn()} disabled={true} />);
    expect(screen.getByTestId('chat-quick-action-study-next')).toBeDisabled();
    expect(screen.getByTestId('chat-quick-action-weakest')).toBeDisabled();
  });
});
