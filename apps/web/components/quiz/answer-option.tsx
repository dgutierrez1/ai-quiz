'use client';

import type { QuestionType } from '@ai-quiz/shared';

interface AnswerOptionProps {
  readonly questionId: string;
  readonly type: QuestionType;
  readonly position: number;
  readonly text: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: () => void;
}

/**
 * AnswerOption — `{components.answer-option}` / `{components.answer-
 * option-selected}` (Story 3.3 AC #3, DESIGN.md § Components).
 *
 * `single` → radio (native `type="radio"`, shared `name` per question —
 * picking another option replaces the previous selection for free).
 * `multiple` → checkbox, individually toggled. Native inputs already
 * supply correct roles/keyboard handling (arrow-key group navigation for
 * radios, individual tabbing for checkboxes) without a Radix dependency —
 * see `components/ui/tabs.tsx` for why this repo doesn't have one.
 *
 * Selection is conveyed by border WEIGHT (1px → 2px) and color together,
 * never color alone (accessibility requirement, not styling). The entire
 * label row is the hit target, and it never dips below 48px.
 */
export function AnswerOption({
  questionId,
  type,
  position,
  text,
  checked,
  disabled = false,
  onChange,
}: AnswerOptionProps): React.JSX.Element {
  const inputId = `answer-${questionId}-${position}`;
  const inputType = type === 'single' ? 'radio' : 'checkbox';

  return (
    <label
      htmlFor={inputId}
      data-testid={`answer-option-${position}`}
      className={[
        'flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[var(--radius-md)] p-4 transition',
        checked
          ? 'border-2 border-[var(--color-primary)] bg-[var(--color-surface-sunken)]'
          : 'border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)]',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      ].join(' ')}
    >
      <input
        id={inputId}
        type={inputType}
        name={type === 'single' ? `question-${questionId}` : undefined}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        data-testid={`answer-option-input-${position}`}
        className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
      />
      {/* Plain text only — {text} auto-escapes. Never markdown/HTML (AD-N1). */}
      <span className="text-[var(--color-ink)]">{text}</span>
    </label>
  );
}
