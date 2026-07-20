// AD-N4 step 3 — category feasibility search + stratified draw.
//
// Pure, I/O-free domain algorithm. Consumes an already-validated question
// pool (Story 2.4's job) and decides which categories the quiz draws from,
// then draws the questions. Never calls an LLM, never re-validates question
// shape/grounding — that is Story 2.4's concern.
//
// Feasibility predicate (AD-N4, corrected 2026-07-19 — see the two counter-
// example fixtures in the test suite):
//   Given availabilities sorted descending a1 >= a2 >= ... >= am, and a
//   candidate category count C, let k = floor(Q/C), r = Q mod C. Then
//     feasible(C) <=> a_C >= k AND (r === 0 OR a_r >= k + 1)
//   Every C in [2, min(8, m)] is evaluated exhaustively — this is a SEARCH,
//   never a decrement-until-feasible loop, because feasibility is NOT
//   monotone in C (see fixture #1: C in [2,6] infeasible, C=8 feasible).

export type Rng = () => number;

export interface PoolQuestionLike {
  readonly category: string;
}

export interface CategorySelectionOptions {
  /** Lowest Q the decrement loop will try before giving up. Default 5. */
  readonly floor?: number;
  /** Injectable RNG — default Math.random. Tests inject a seeded stub for determinism. */
  readonly rng?: Rng;
}

export interface CategorySelectionSuccess<T extends PoolQuestionLike> {
  readonly ok: true;
  /** Q actually used (== requested unless the decrement loop kicked in). */
  readonly actualCount: number;
  readonly categoryCount: number;
  readonly selectedCategories: readonly string[];
  /** length === actualCount; array order IS the final position order (0..actualCount-1). */
  readonly drawnQuestions: readonly T[];
}

export interface CategorySelectionFailure {
  readonly ok: false;
  readonly reason: 'CATEGORY_SELECTION_INFEASIBLE';
}

export type CategorySelectionResult<T extends PoolQuestionLike> =
  CategorySelectionSuccess<T> | CategorySelectionFailure;

/** Groups pool questions by category, sorted descending by availability, ties broken ascending by category name for determinism. */
export function groupAndSortByAvailability<T extends PoolQuestionLike>(
  pool: readonly T[],
): Array<readonly [string, readonly T[]]> {
  const groups = new Map<string, T[]>();
  for (const question of pool) {
    const list = groups.get(question.category) ?? [];
    list.push(question);
    groups.set(question.category, list);
  }
  return [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
}

/** feasible(C) per AD-N4's corrected predicate. `sortedCounts` must already be sorted descending. */
export function feasible(
  sortedCounts: readonly number[],
  questionCount: number,
  categoryCount: number,
): boolean {
  if (categoryCount < 1 || categoryCount > sortedCounts.length) return false;
  const k = Math.floor(questionCount / categoryCount);
  const r = questionCount % categoryCount;
  const aC = sortedCounts[categoryCount - 1] ?? 0;
  if (aC < k) return false;
  if (r === 0) return true;
  const aR = sortedCounts[r - 1] ?? 0;
  return aR >= k + 1;
}

/**
 * Exhaustively evaluates every C in [2, min(8, m)] — never decrements and
 * stops early, since feasibility is non-monotone in C. Prefers a uniformly
 * random feasible C in [4,6]; falls back to a uniformly random feasible C
 * from the full range. Returns undefined when no C is feasible.
 */
export function searchFeasibleC(
  sortedCounts: readonly number[],
  questionCount: number,
  distinctCategoryCount: number,
  rng: Rng = Math.random,
): number | undefined {
  const upper = Math.min(8, distinctCategoryCount);
  const feasibleCs: number[] = [];
  for (let c = 2; c <= upper; c += 1) {
    if (feasible(sortedCounts, questionCount, c)) feasibleCs.push(c);
  }
  if (feasibleCs.length === 0) return undefined;
  const preferred = feasibleCs.filter((c) => c >= 4 && c <= 6);
  const candidates = preferred.length > 0 ? preferred : feasibleCs;
  const index = Math.min(Math.floor(rng() * candidates.length), candidates.length - 1);
  return candidates[index];
}

export interface FeasibleSelection {
  readonly Q: number;
  readonly C: number;
  readonly selectedCategories: readonly string[];
}

/**
 * Q-decrement loop with a floor (default 5): for Q from `requestedQuestionCount`
 * down to `floor`, run the exhaustive search (searchFeasibleC) at that Q; stop
 * on the first feasible hit. Returns undefined if no Q in [floor, requested]
 * yields a feasible C — this is the second, independent path to `failed`
 * alongside Story 2.4's shortfall-driven UntrustedLlmOutputError.
 */
export function findFeasibleSelection(
  sortedEntries: ReadonlyArray<readonly [string, readonly PoolQuestionLike[]]>,
  requestedQuestionCount: number,
  opts: { readonly floor: number; readonly rng: Rng },
): FeasibleSelection | undefined {
  const counts = sortedEntries.map(([, items]) => items.length);
  const m = sortedEntries.length;
  for (let Q = requestedQuestionCount; Q >= opts.floor; Q -= 1) {
    const C = searchFeasibleC(counts, Q, m, opts.rng);
    if (C !== undefined) {
      const selectedCategories = sortedEntries.slice(0, C).map(([category]) => category);
      return { Q, C, selectedCategories };
    }
  }
  return undefined;
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i]!;
    const b = arr[j]!;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

/**
 * Draws Q questions evenly across the selected categories: each category
 * receives floor(Q/C) or ceil(Q/C) (the first `Q mod C` categories, by
 * availability-sorted order, get the +1). A count of 0 is permitted for a
 * selected category when Q < C. The array order returned IS the final
 * position order — do not reorder after this call.
 */
export function stratifiedDrawFromGroups<T extends PoolQuestionLike>(
  sortedEntries: ReadonlyArray<readonly [string, readonly T[]]>,
  selectedCategories: readonly string[],
  questionCount: number,
  rng: Rng,
): T[] {
  const categoryCount = selectedCategories.length;
  const base = Math.floor(questionCount / categoryCount);
  const extra = questionCount % categoryCount;
  const byCategory = new Map(sortedEntries);
  const drawn: T[] = [];
  selectedCategories.forEach((category, index) => {
    const quota = base + (index < extra ? 1 : 0);
    if (quota === 0) return;
    const items = byCategory.get(category) ?? [];
    drawn.push(...shuffle(items, rng).slice(0, quota));
  });
  return drawn;
}

/**
 * Single entry point: category feasibility search (with Q-decrement) +
 * stratified draw. `requestedQuestionCount` is the Q to start the decrement
 * loop from (Story 2.4's classification `q`, i.e. `questionCount` on the
 * 'full' outcome or the shortfall's `validCount` on the 'shortfall' outcome).
 */
export function selectCategoriesAndDraw<T extends PoolQuestionLike>(
  validPool: readonly T[],
  requestedQuestionCount: number,
  opts: CategorySelectionOptions = {},
): CategorySelectionResult<T> {
  const floor = opts.floor ?? 5;
  const rng = opts.rng ?? Math.random;
  const sortedEntries = groupAndSortByAvailability(validPool);
  // Precondition (Story 2.4's shortfall ladder guarantees >= 2 distinct
  // categories survive before handoff) — assert, don't silently fail, since
  // violating it here indicates a bug in the 2.4/2.5 handoff.
  if (sortedEntries.length < 2) return { ok: false, reason: 'CATEGORY_SELECTION_INFEASIBLE' };

  const startQ = Math.min(requestedQuestionCount, validPool.length);
  const found = findFeasibleSelection(sortedEntries, startQ, { floor, rng });
  if (!found) return { ok: false, reason: 'CATEGORY_SELECTION_INFEASIBLE' };

  const drawnQuestions = stratifiedDrawFromGroups(
    sortedEntries,
    found.selectedCategories,
    found.Q,
    rng,
  );
  return {
    ok: true,
    actualCount: found.Q,
    categoryCount: found.C,
    selectedCategories: found.selectedCategories,
    drawnQuestions,
  };
}
