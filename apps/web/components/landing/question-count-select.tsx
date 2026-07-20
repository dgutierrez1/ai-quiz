'use client';

const QUESTION_COUNT_OPTIONS = [5, 6, 7, 8] as const;
export type QuestionCount = (typeof QUESTION_COUNT_OPTIONS)[number];

interface QuestionCountSelectProps {
  readonly value: QuestionCount;
  readonly onChange: (next: QuestionCount) => void;
  readonly disabled?: boolean;
  readonly describedBy?: string;
}

/**
 * QuestionCountSelect (Story 2.7 AC #4).
 *
 * Integers 5–8, default 8. Question count is the ONE field allowed a
 * pre-filled value (EXPERIENCE.md). Changing it is not a destructive
 * action; the form preserves every other value.
 */
export function QuestionCountSelect({
  value,
  onChange,
  disabled = false,
  describedBy,
}: QuestionCountSelectProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="question-count-select"
        className="text-sm font-medium text-[var(--color-ink)]"
      >
        Question count
      </label>
      <select
        id="question-count-select"
        data-testid="question-count-select"
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(Number(event.target.value) as QuestionCount)}
        className="min-h-[44px] rounded-md border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] px-3 text-[var(--color-ink)]"
      >
        {QUESTION_COUNT_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}

export { QUESTION_COUNT_OPTIONS };
