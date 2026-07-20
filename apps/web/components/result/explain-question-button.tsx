export interface ExplainQuestionButtonProps {
  /** 1-based, for the visible label and template text. */
  readonly questionNumber: number;
  readonly wasCorrect: boolean;
  /** Human-readable rendering of the user's selected answer(s). */
  readonly selectionText: string;
  readonly onExplain: (prefillText: string) => void;
}

/**
 * ExplainQuestionButton (Story 4.3 Task 6) — owned and shipped by this
 * story, mounted once per question by `QuestionBreakdownItem`.
 *
 * Client-side only: pre-fills the chat input with the exact template
 * string below and calls `onExplain`. Nothing is sent to the server — no
 * `questionId`, no anchor, ever (AC #7). The reference to "question {n}"
 * lives only in the plain-text message content.
 */
export function ExplainQuestionButton({
  questionNumber,
  wasCorrect,
  selectionText,
  onExplain,
}: ExplainQuestionButtonProps): React.JSX.Element {
  const handleClick = (): void => {
    const correctness = wasCorrect ? 'correctly' : 'incorrectly';
    onExplain(`Explain question ${questionNumber} — I answered ${correctness}: ${selectionText}`);
  };

  return (
    <button
      type="button"
      data-testid={`explain-question-${questionNumber}`}
      onClick={handleClick}
      className="min-h-[44px] rounded-[var(--radius-sm)] px-3 text-sm font-medium text-[var(--color-primary)] underline"
    >
      Explain Q{questionNumber}
    </button>
  );
}
