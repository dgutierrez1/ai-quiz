'use client';

import type { QuizSessionStrategy } from '@ai-quiz/shared';

const STRATEGY_OPTIONS: ReadonlyArray<{
  readonly value: QuizSessionStrategy;
  readonly label: string;
  readonly hint: string;
}> = [
  { value: 'factual', label: 'Factual', hint: 'Recalls specific facts from the source.' },
  { value: 'comprehension', label: 'Comprehension', hint: 'Reasons about meaning and intent.' },
  { value: 'mixed', label: 'Mixed', hint: 'A balance of facts and reasoning.' },
  { value: 'trivia', label: 'Trivia', hint: 'Surface-level details and names.' },
];

interface StrategyPickerProps {
  readonly value: QuizSessionStrategy | undefined;
  readonly onChange: (next: QuizSessionStrategy) => void;
  readonly disabled?: boolean;
  readonly describedBy?: string;
}

/**
 * StrategyPicker (Story 2.7 AC #4, #5).
 *
 * Required, with NO pre-selection — the initial value is `undefined` and
 * the form cannot submit until the user picks one. This is a stated
 * security property: free-text strategy would be a prompt-injection vector,
 * and a UI that "helpfully" defaults it undermines the deliberate-choice
 * requirement FR-2 relies on.
 *
 * The entire option row is the hit target (44px+ minimum), consistent
 * with the answer-option pattern used elsewhere in the product.
 */
export function StrategyPicker({
  value,
  onChange,
  disabled = false,
  describedBy,
}: StrategyPickerProps): React.JSX.Element {
  return (
    <fieldset disabled={disabled} aria-describedby={describedBy} className="flex flex-col gap-3">
      <legend className="text-sm font-medium text-[var(--color-ink)]">Strategy</legend>
      <div
        role="radiogroup"
        aria-label="Strategy"
        className="grid grid-cols-1 gap-2 md:grid-cols-2"
      >
        {STRATEGY_OPTIONS.map((option) => {
          const selected = value === option.value;
          const id = `strategy-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={id}
              data-testid={`strategy-option-${option.value}`}
              className={[
                'flex min-h-[48px] cursor-pointer items-start gap-3 rounded-md border p-4 transition',
                selected
                  ? 'border-2 border-[var(--color-primary)] bg-[var(--color-surface-sunken)]'
                  : 'border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)]',
                disabled ? 'cursor-not-allowed opacity-60' : '',
              ].join(' ')}
            >
              <input
                id={id}
                type="radio"
                name="strategy"
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.value)}
                className="mt-1 h-4 w-4 accent-[var(--color-primary)]"
                data-testid={`strategy-radio-${option.value}`}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-[var(--color-ink)]">{option.label}</span>
                <span className="text-xs text-[var(--color-ink-muted)]">{option.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export { STRATEGY_OPTIONS };
