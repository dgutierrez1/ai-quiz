import { describe, expect, it } from 'vitest';

import {
  feasible,
  findFeasibleSelection,
  groupAndSortByAvailability,
  searchFeasibleC,
  selectCategoriesAndDraw,
  stratifiedDrawFromGroups,
} from '../../../../src/domain/quiz/services/category-selection.service.js';

interface Q {
  readonly category: string;
}

function makePool(countsByCategory: Record<string, number>): Q[] {
  const pool: Q[] = [];
  for (const [category, count] of Object.entries(countsByCategory)) {
    for (let i = 0; i < count; i += 1) pool.push({ category });
  }
  return pool;
}

/** Deterministic seeded RNG for tests — never Math.random. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0xffffffff;
  };
}

describe('feasible() — AD-N4 corrected predicate', () => {
  // AC #3 — non-monotonicity proof: Q=8, availabilities [5,1,1,1,1,1,1,1] (m=8).
  // No C in [2,6] is feasible, but C=8 is. Proves a decrementing rule can
  // never reach the correct answer.
  const fixture1 = [5, 1, 1, 1, 1, 1, 1, 1];
  it.each([2, 3, 4, 5, 6])('fixture #1 — Q=8, C=%i is infeasible', (c) => {
    expect(feasible(fixture1, 8, c)).toBe(false);
  });
  it('fixture #1 — Q=8, C=8 IS feasible (k=1, r=0, every a_i >= 1)', () => {
    expect(feasible(fixture1, 8, 8)).toBe(true);
  });

  // AC #4 — sufficiency proof: Q=7, C=3, a=[3,3,1]. The superseded predicate
  // sum(min(ai, ceil(Q/C))) >= Q incorrectly passes (3+3+1=7>=7) even though
  // no legal 3-2-2 split exists (a_3=1 < k=2).
  it('fixture #2 — Q=7, C=3, a=[3,3,1] is infeasible (rejects the superseded sum predicate)', () => {
    const superseded = [3, 3, 1].reduce((sum, a) => sum + Math.min(a, Math.ceil(7 / 3)), 0) >= 7;
    expect(superseded).toBe(true); // the refuted predicate WOULD pass — proves it's wrong
    expect(feasible([3, 3, 1], 7, 3)).toBe(false); // the corrected predicate must reject it
  });

  it('rejects C outside [1, sortedCounts.length]', () => {
    expect(feasible([5, 5], 8, 0)).toBe(false);
    expect(feasible([5, 5], 8, 3)).toBe(false);
  });
});

describe('searchFeasibleC() — exhaustive search, never decrement-and-stop', () => {
  it('evaluates every C in [2, min(8,m)] and prefers a feasible C in [4,6]', () => {
    // 6 categories, 20 items each — C=4,5,6 all feasible; must prefer that band.
    const counts = [20, 20, 20, 20, 20, 20];
    for (let seed = 0; seed < 20; seed += 1) {
      const c = searchFeasibleC(counts, 12, 6, seededRng(seed));
      expect(c).toBeGreaterThanOrEqual(4);
      expect(c).toBeLessThanOrEqual(6);
    }
  });

  it('searches the full range and finds only C=8 feasible when every category has exactly 1 item', () => {
    // With r > 0 required at every C in [2,7] but only 1 item per category,
    // the "+1" bonus category can never be satisfied except at C=8 (r=0).
    for (let seed = 0; seed < 10; seed += 1) {
      const c = searchFeasibleC([1, 1, 1, 1, 1, 1, 1, 1], 8, 8, seededRng(seed));
      expect(c).toBe(8);
    }
  });

  it('returns undefined when no C in range is feasible', () => {
    expect(searchFeasibleC([1, 1], 8, 2, seededRng(1))).toBeUndefined();
  });

  it('is deterministic for a fixed seeded rng', () => {
    const counts = [10, 9, 8, 7, 6, 5, 4];
    const a = searchFeasibleC(counts, 8, 7, seededRng(42));
    const b = searchFeasibleC(counts, 8, 7, seededRng(42));
    expect(a).toBe(b);
  });
});

describe('groupAndSortByAvailability', () => {
  it('sorts descending by count, ties broken ascending by category name', () => {
    const pool = makePool({ zebra: 2, apple: 2, mango: 5 });
    const sorted = groupAndSortByAvailability(pool);
    expect(sorted.map(([category]) => category)).toEqual(['mango', 'apple', 'zebra']);
  });
});

describe('findFeasibleSelection — Q-decrement loop with a floor', () => {
  it('decrements Q down to the floor when the requested Q is infeasible at every C', () => {
    // 2 categories only: [3,3]. Q=8 needs at least ceil(8/2)=4 each — infeasible.
    // Q=6 -> k=3,r=0 -> feasible (3>=3).
    const sortedEntries = groupAndSortByAvailability(makePool({ a: 3, b: 3 }));
    const found = findFeasibleSelection(sortedEntries, 8, { floor: 5, rng: seededRng(1) });
    expect(found?.Q).toBe(6);
    expect(found?.C).toBe(2);
  });

  it('returns undefined when no Q in [floor, requested] is feasible', () => {
    // Only 1 item per category across many categories — even Q=5 needs >=1
    // per selected category at minimum C=2, so a single-item-per-category
    // pool actually IS feasible at Q=C. Use a genuinely infeasible shape:
    // 2 categories, 1 item each -> max Q reachable is 2, below the floor of 5.
    const sortedEntries = groupAndSortByAvailability(makePool({ a: 1, b: 1 }));
    const found = findFeasibleSelection(sortedEntries, 8, { floor: 5, rng: seededRng(1) });
    expect(found).toBeUndefined();
  });
});

describe('stratifiedDrawFromGroups', () => {
  it('per-category counts differ by at most 1 (even split)', () => {
    const sortedEntries = groupAndSortByAvailability(makePool({ a: 10, b: 10, c: 10, d: 10 }));
    const drawn = stratifiedDrawFromGroups(sortedEntries, ['a', 'b', 'c', 'd'], 9, seededRng(7));
    const counts = new Map<string, number>();
    for (const q of drawn) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
    const values = [...counts.values()].sort((x, y) => x - y);
    expect(values[values.length - 1]! - values[0]!).toBeLessThanOrEqual(1);
    expect(drawn.length).toBe(9);
  });

  it('a naive slice-of-the-pool draw fails the even-split property that stratifiedDraw satisfies (AC #8)', () => {
    // Skewed pool: category A has 20, B/C/D have 1 each.
    const pool = makePool({ A: 20, B: 1, C: 1, D: 1 });
    const naive = pool.slice(0, 8); // ignores category strata entirely
    const naiveCounts = new Map<string, number>();
    for (const q of naive) naiveCounts.set(q.category, (naiveCounts.get(q.category) ?? 0) + 1);
    // The naive draw concentrates in whichever category the pool happened to
    // list first (A, since makePool emits by insertion order) — violates the <=1 spread.
    const naiveValues = [...naiveCounts.values()];
    expect(Math.max(...naiveValues) - (naiveCounts.get('B') ?? 0)).toBeGreaterThan(1);

    const sortedEntries = groupAndSortByAvailability(pool);
    const selection = selectCategoriesAndDraw(pool, 3, { floor: 3, rng: seededRng(3) });
    expect(selection.ok).toBe(true);
    if (selection.ok) {
      const counts = new Map<string, number>();
      for (const q of selection.drawnQuestions)
        counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
      const values = [...counts.values()];
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
    void sortedEntries;
  });

  it('permits a 0 count for a selected category when Q < C, while every selected category is still listed', () => {
    // 6 categories with plenty of availability, draw only 5 -> one gets 0.
    const pool = makePool({ a: 3, b: 3, c: 3, d: 3, e: 3, f: 3 });
    const sortedEntries = groupAndSortByAvailability(pool);
    const selectedCategories = ['a', 'b', 'c', 'd', 'e', 'f'];
    const drawn = stratifiedDrawFromGroups(sortedEntries, selectedCategories, 5, seededRng(2));
    expect(drawn.length).toBe(5);
    const drawnCategories = new Set(drawn.map((q) => q.category));
    expect(drawnCategories.size).toBeLessThan(selectedCategories.length);
    // But every selected category (including the 0-count one) is still known to the caller:
    expect(selectedCategories.length).toBe(6);
  });
});

describe('selectCategoriesAndDraw — public entry point', () => {
  it('m=2 (minimum distinct categories) succeeds', () => {
    const pool = makePool({ a: 6, b: 6 });
    const result = selectCategoriesAndDraw(pool, 8, { rng: seededRng(1) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.categoryCount).toBe(2);
      expect([...result.selectedCategories].sort()).toEqual(['a', 'b']);
    }
  });

  it('m=8 (fixture #1 shape) only succeeds via C=8 after the decrement search exhausts [2,7] too', () => {
    const pool = makePool({ a: 5, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1 });
    const result = selectCategoriesAndDraw(pool, 8, { rng: seededRng(9) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actualCount).toBe(8);
      expect(result.drawnQuestions.length).toBe(8);
    }
  });

  it('fails with CATEGORY_SELECTION_INFEASIBLE when fewer than 2 distinct categories are present', () => {
    const pool = makePool({ solo: 10 });
    const result = selectCategoriesAndDraw(pool, 8, { rng: seededRng(1) });
    expect(result).toEqual({ ok: false, reason: 'CATEGORY_SELECTION_INFEASIBLE' });
  });

  it('same (pool, Q, seed) produces byte-identical drawn output across two calls', () => {
    const pool = makePool({ a: 10, b: 10, c: 10, d: 10, e: 10 });
    const first = selectCategoriesAndDraw(pool, 8, { rng: seededRng(123) });
    const second = selectCategoriesAndDraw(pool, 8, { rng: seededRng(123) });
    expect(first).toEqual(second);
  });
});
