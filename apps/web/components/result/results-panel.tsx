import type { SubmittedSessionDetail } from '../../lib/types';
import { CategoryBreakdown } from './category-breakdown';
import { InsightsPanel } from './insights-panel';
import { QuestionBreakdownList } from './question-breakdown-list';
import { ScoreDisplay } from './score-display';

interface ResultsPanelProps {
  readonly session: SubmittedSessionDetail;
  /**
   * Story 4.3 addition — threaded through to each `ExplainQuestionButton`
   * in the breakdown list. Optional so this component's own contract
   * doesn't regress for any caller that predates Story 4.3.
   */
  readonly onExplain?: (prefillText: string) => void;
}

/**
 * ResultsPanel (Story 3.2 AC #6–#9) — composition root. No "Analyze gaps"
 * trigger anywhere; insights render inline as part of the same component
 * tree.
 *
 * Story 4.3 only adds the `onExplain` pass-through prop below — score
 * display, category breakdown, and the insights narrative are untouched.
 */
export function ResultsPanel({ session, onExplain }: ResultsPanelProps): React.JSX.Element {
  const questions = session.questions ?? [];

  return (
    <section data-testid="results-panel" className="flex flex-col gap-8">
      <ScoreDisplay value={session.finalScore} />
      <CategoryBreakdown categories={session.categoryBreakdown} />
      <QuestionBreakdownList
        questions={questions}
        breakdown={session.breakdown}
        onExplain={onExplain}
      />
      <InsightsPanel insights={session.insights} />
    </section>
  );
}
