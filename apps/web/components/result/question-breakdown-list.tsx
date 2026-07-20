import type { CreatedQuestionDto } from '@ai-quiz/shared';

import type { QuestionResultDto } from '../../lib/types';
import { QuestionBreakdownItem } from './question-breakdown-item';

interface QuestionBreakdownListProps {
  readonly questions: readonly CreatedQuestionDto[];
  readonly breakdown: readonly QuestionResultDto[];
  /** Story 4.3 addition — threaded through to each `ExplainQuestionButton`. */
  readonly onExplain?: (prefillText: string) => void;
}

/**
 * QuestionBreakdownList (Story 3.2 AC #8) — zips `breakdown[]` with
 * question/answer data by `questionId`, ordered by the question's own
 * `position` (server order, never re-shuffled). A question with no
 * matching result entry is skipped rather than thrown on — defensive
 * against the "not fully pinned upstream" API contract.
 */
export function QuestionBreakdownList({
  questions,
  breakdown,
  onExplain,
}: QuestionBreakdownListProps): React.JSX.Element {
  const resultByQuestionId = new Map(breakdown.map((r) => [r.questionId, r] as const));
  const ordered = [...questions].sort((a, b) => a.position - b.position);

  return (
    <ol data-testid="question-breakdown-list" className="flex flex-col gap-4">
      {ordered.map((question, index) => {
        const result = resultByQuestionId.get(question.id);
        if (!result) return null;
        return (
          <QuestionBreakdownItem
            key={question.id}
            question={question}
            result={result}
            index={index}
            onExplain={onExplain}
          />
        );
      })}
    </ol>
  );
}
