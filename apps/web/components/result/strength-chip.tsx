import type { CategoryStrength } from '@ai-quiz/shared';

const STRENGTH_COLOR_VAR: Record<CategoryStrength, string> = {
  strong: 'var(--color-strength-strong)',
  mixed: 'var(--color-strength-mixed)',
  weak: 'var(--color-strength-weak)',
};

interface StrengthChipProps {
  readonly strength: CategoryStrength;
  readonly label: string;
  readonly testId?: string;
}

/**
 * StrengthChip — `{components.strength-chip}` (Story 3.2 AC #7).
 *
 * Solid strength-scale fill (never tinted-background — that pairing drops
 * below AA on sunken surfaces per DESIGN.md) with
 * `{colors.strength-foreground}` text. ALWAYS renders its literal
 * `strong`/`mixed`/`weak` label as text — color is reinforcement only,
 * never the sole carrier of the meaning. `weak` renders in clay, never
 * red — see DESIGN.md § Colors.
 */
export function StrengthChip({ strength, label, testId }: StrengthChipProps): React.JSX.Element {
  return (
    <span
      data-testid={testId}
      data-strength={strength}
      className="inline-flex items-center gap-1 rounded-[var(--radius-full)] px-3 py-1 text-xs font-medium text-[var(--color-strength-foreground)]"
      style={{ backgroundColor: STRENGTH_COLOR_VAR[strength] }}
    >
      <span>{label}</span>
      <span aria-hidden="true">·</span>
      <span data-testid={testId ? `${testId}-label` : undefined}>{strength}</span>
    </span>
  );
}
