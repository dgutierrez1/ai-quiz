import type { CategoryPerformanceDto } from '@ai-quiz/shared';

import { StrengthChip } from './strength-chip';

interface CategoryBreakdownProps {
  readonly categories: readonly CategoryPerformanceDto[];
}

function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * CategoryBreakdown — maps `categoryBreakdown[]` to a `StrengthChip` per
 * category (Story 3.2 AC #7). A category with 0 questions is never
 * rendered — there should be none in the payload, but this guards
 * defensively anyway per the story's instruction.
 */
export function CategoryBreakdown({ categories }: CategoryBreakdownProps): React.JSX.Element {
  const withQuestions = categories.filter((c) => c.questionCount >= 1);

  return (
    <section
      data-testid="category-breakdown"
      aria-label="Category strength"
      className="flex flex-wrap gap-2"
    >
      {withQuestions.map((c) => (
        <StrengthChip
          key={c.name}
          strength={c.strength}
          label={c.name}
          testId={`strength-chip-${slug(c.name)}`}
        />
      ))}
    </section>
  );
}
