// AD-N4 steps 1-2 — the shortfall ladder's classification-only step. Pure
// function: given the count of pool questions that survived Zod shape
// validation + grounding + secret-token checks (`validCount`) and the number
// of distinct categories among them, decide the outcome. This function does
// NOT retry or throw — the caller (GenerateQuizUseCase) owns the retry loop
// and the terminal `UntrustedLlmOutputError` on exhaustion.

export type ShortfallOutcome = 'full' | 'shortfall' | 'regenerate';

export interface ShortfallClassification {
  readonly outcome: ShortfallOutcome;
  /**
   * The Q to carry forward: `questionCount` on 'full', `validCount` on
   * 'shortfall' (this becomes `actualCount`), 0 on 'regenerate' (unused).
   */
  readonly q: number;
}

const MIN_VALID_QUESTIONS = 5;
const MIN_DISTINCT_CATEGORIES = 2;

export function classifyShortfall(
  validCount: number,
  distinctCategories: number,
  questionCount: number,
): ShortfallClassification {
  if (validCount < MIN_VALID_QUESTIONS || distinctCategories < MIN_DISTINCT_CATEGORIES) {
    return { outcome: 'regenerate', q: 0 };
  }
  if (validCount >= questionCount) {
    return { outcome: 'full', q: questionCount };
  }
  return { outcome: 'shortfall', q: validCount };
}
