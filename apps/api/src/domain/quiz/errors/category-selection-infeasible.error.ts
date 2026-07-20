// Story 2.5's second, independent path to `status='failed'` — distinct from
// Story 2.4's `UntrustedLlmOutputError` (pool-validation shortfall
// exhaustion). Raised when no Q in [floor, requestedQuestionCount] yields a
// feasible category count C, even after the exhaustive search at every Q.
export class CategorySelectionInfeasibleError extends Error {
  public constructor(detail = 'No feasible category split exists for the validated question pool') {
    super(detail);
    this.name = 'CategorySelectionInfeasibleError';
  }
}
