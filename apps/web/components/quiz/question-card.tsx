'use client';

import type { SessionQuestionWireDto } from '@ai-quiz/shared';

import { AnswerOption } from './answer-option';

interface QuestionCardProps {
  readonly question: SessionQuestionWireDto;
  readonly selected: readonly number[];
  readonly disabled?: boolean;
  readonly onToggle: (position: number) => void;
  readonly headingRef: React.RefObject<HTMLHeadingElement>;
}

/**
 * QuestionCard (Story 3.3 Task 4).
 *
 * The question text IS the page's `<h1>` — AC #10 explicitly allows this
 * ("the question text carries the primary heading role") rather than a
 * separate, redundant page title. `tabIndex={-1}` + the ref lets
 * `quiz-runner.tsx` move focus here on every question advance
 * (EXPERIENCE.md Interaction Primitives: "On question advance, focus
 * moves to the question text").
 *
 * `category` is never rendered here even though the wire type happens to
 * carry it — EXPERIENCE.md: "Categories are hidden here and revealed only
 * at results." Single column, no `md:`/`lg:` breakpoint classes anywhere
 * in this subtree (AC #9 — no structural breakpoint on this route).
 */
export function QuestionCard({
  question,
  selected,
  disabled = false,
  onToggle,
  headingRef,
}: QuestionCardProps): React.JSX.Element {
  const selectedSet = new Set(selected);

  return (
    <div data-testid="question-card" className="flex flex-col gap-6">
      <h1
        ref={headingRef}
        tabIndex={-1}
        data-testid="question-text"
        className="text-[length:var(--text-question)] leading-[1.5] font-medium text-[var(--color-ink)] outline-none"
      >
        {/* Plain text only — {question.text} auto-escapes (AD-N1, security control). */}
        {question.text}
      </h1>
      <fieldset
        disabled={disabled}
        className="flex flex-col gap-[var(--spacing-option-gap)] border-0 p-0"
      >
        <legend className="sr-only">Answer options</legend>
        {question.answers.map((answer) => (
          <AnswerOption
            key={answer.position}
            questionId={question.id}
            type={question.type}
            position={answer.position}
            text={answer.text}
            checked={selectedSet.has(answer.position)}
            disabled={disabled}
            onChange={() => onToggle(answer.position)}
          />
        ))}
      </fieldset>
    </div>
  );
}
