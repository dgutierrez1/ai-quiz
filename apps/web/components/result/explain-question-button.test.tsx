import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ExplainQuestionButton } from './explain-question-button';

describe('ExplainQuestionButton', () => {
  it('produces the exact "correctly" template string and sends nothing but the text (AC #7)', async () => {
    const onExplain = vi.fn();
    render(
      <ExplainQuestionButton
        questionNumber={3}
        wasCorrect={true}
        selectionText="Option B"
        onExplain={onExplain}
      />,
    );

    await userEvent.click(screen.getByTestId('explain-question-3'));

    expect(onExplain).toHaveBeenCalledTimes(1);
    expect(onExplain).toHaveBeenCalledWith('Explain question 3 — I answered correctly: Option B');
  });

  it('produces the exact "incorrectly" template string', async () => {
    const onExplain = vi.fn();
    render(
      <ExplainQuestionButton
        questionNumber={1}
        wasCorrect={false}
        selectionText="Option A"
        onExplain={onExplain}
      />,
    );

    await userEvent.click(screen.getByTestId('explain-question-1'));

    expect(onExplain).toHaveBeenCalledTimes(1);
    expect(onExplain).toHaveBeenCalledWith('Explain question 1 — I answered incorrectly: Option A');
  });

  it('carries a 1-based, per-question data-testid', () => {
    render(
      <ExplainQuestionButton
        questionNumber={5}
        wasCorrect={false}
        selectionText="none"
        onExplain={vi.fn()}
      />,
    );
    expect(screen.getByTestId('explain-question-5')).toBeInTheDocument();
  });
});
