import type { CreatedQuestionDto } from '@ai-quiz/shared';

import type { QuestionResultDto } from '../../lib/types';
import { ExplainQuestionButton } from './explain-question-button';

interface QuestionBreakdownItemProps {
  readonly question: CreatedQuestionDto;
  readonly result: QuestionResultDto;
  readonly index: number;
  /** Story 4.3 addition — wired to `ExplainQuestionButton`. */
  readonly onExplain?: (prefillText: string) => void;
}

/**
 * QuestionBreakdownItem (Story 3.2 AC #8).
 *
 * Renders question text and all 4 answers in SERVER order (position 0–3,
 * never re-shuffled). Question/answer text is plain text only — `{text}`
 * auto-escaping, no markdown/HTML renderer — this is a security control
 * (AD-N1), not a styling choice, even on the results page where
 * correctness has already been revealed.
 *
 * Correctness and "your selection" are both a) never conveyed by color
 * alone (text tags), and b) never rendered in red — a wrong answer is
 * information, not judgment, on this page too.
 *
 * Story 4.3 mounts one `ExplainQuestionButton` per question here (owned
 * and shipped by Story 4.3, mounted by this file per its Dev Notes § Chat
 * slot contract). `wasCorrect` uses `result.rawScore === 4` — full credit
 * — rather than re-deriving set equality, since multi-answer questions can
 * score partial credit that shouldn't read as "correctly" in the prefill
 * template.
 */
export function QuestionBreakdownItem({
  question,
  result,
  index,
  onExplain,
}: QuestionBreakdownItemProps): React.JSX.Element {
  const correctPositions = new Set(
    question.answers.filter((a) => a.isCorrect).map((a) => a.position),
  );
  const selectedPositions = new Set(result.selected);
  const selectedAnswers = question.answers.filter((a) => selectedPositions.has(a.position));
  const selectionText =
    selectedAnswers.length > 0 ? selectedAnswers.map((a) => a.text).join(', ') : 'no answer';
  const wasCorrect = result.rawScore === 4;

  return (
    <li
      data-testid={`breakdown-question-${index}`}
      className="rounded-[var(--radius-md)] border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] p-[var(--spacing-card-padding)]"
    >
      <div className="flex items-start justify-between gap-3">
        <p
          data-testid={`breakdown-question-text-${index}`}
          className="text-[length:var(--text-question)] font-medium text-[var(--color-ink)]"
        >
          {index + 1}. {question.text}
        </p>
        {onExplain && (
          <ExplainQuestionButton
            questionNumber={index + 1}
            wasCorrect={wasCorrect}
            selectionText={selectionText}
            onExplain={onExplain}
          />
        )}
      </div>
      <ul className="mt-3 flex flex-col gap-[var(--spacing-option-gap)]">
        {question.answers.map((answer) => {
          const isCorrect = correctPositions.has(answer.position);
          const wasSelected = selectedPositions.has(answer.position);
          const tags: string[] = [];
          if (isCorrect) tags.push('Correct answer');
          if (wasSelected) tags.push(isCorrect ? 'Your selection' : 'Your selection (not correct)');

          return (
            <li
              key={answer.position}
              data-testid={`breakdown-answer-${index}-${answer.position}`}
              data-correct={isCorrect}
              data-selected={wasSelected}
              className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-surface-sunken)] px-3 py-2 text-sm text-[var(--color-ink)]"
            >
              <span>{answer.text}</span>
              {tags.length > 0 && (
                <span className="text-xs text-[var(--color-ink-muted)]">{tags.join(' · ')}</span>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
