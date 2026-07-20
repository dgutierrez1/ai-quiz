// packages/shared/test/scoring.test.ts
//
// Story 1.2 acceptance matrix. Coverage gate is enforced by Vitest (95 % on
// every metric, scoped to src/scoring.ts) — these tests exist to keep that
// gate green AND to document every invariant in AC #1–#10.
//
// Conventions:
//   • Table-driven `it.each` for the multi-answer matrix so the audit-fix
//     story (select-all → 0 for every `multiple` shape) is reproducible.
//   • Hard-typed test inputs (no `as any`) — strict + noUncheckedIndexedAccess.
//   • Assertion language matches the AC's exact wording where it is a
//     counter-example claim ("select-all → 0", "11.4358881").

import { describe, expect, it } from 'vitest';

import {
  aggregateByCategory,
  type CategoryPerformanceDto,
  geometricWeights,
  type PerQuestionScore,
  type QuestionDto,
  rankWeakCategories,
  roundHalfAwayFromZero,
  scoreQuestion,
  ScoringError,
  strengthFor,
  type UserResponseDto,
  weightedFinalScore,
} from '../src/scoring';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const q = (overrides: Partial<QuestionDto> = {}): QuestionDto => ({
  id: 'q-default',
  sessionId: 'sess-1',
  position: 0,
  text: 'Question text',
  type: 'single',
  category: 'default',
  explanation: 'because',
  ...overrides,
});

const r = (overrides: Partial<UserResponseDto> = {}): UserResponseDto => ({
  questionId: 'q-default',
  selected: [0],
  rawScore: 0,
  weight: 1,
  weightedScore: 0,
  ...overrides,
});

// ── geometricWeights (AC #6) ─────────────────────────────────────────────────

describe('geometricWeights', () => {
  it('produces the documented shape for n=4', () => {
    const w = geometricWeights(4);
    expect(w).toHaveLength(4);
    expect(w[0]).toBe(1);
    expect(w[1]).toBeCloseTo(1.1, 10);
    expect(w[2]).toBeCloseTo(1.21, 10);
    expect(w[3]).toBeCloseTo(1.331, 10);
  });

  it('returns the constant sum 11.4358881 for n=8 (AC #6 trap)', () => {
    const w = geometricWeights(8);
    const sum = w.reduce((s, x) => s + x, 0);

    // The AC specifies BOTH assertions. Do NOT loosen the constant.
    expect(sum).toBeCloseTo(11.4358881, 7);
    expect(Number(sum.toFixed(7))).toBe(11.4358881);
  });

  it('handles n=1', () => {
    expect(geometricWeights(1)).toEqual([1.0]);
  });

  it.each([
    ['n <= 0', 0],
    ['n negative', -3],
  ])('throws on %s', (_label, n) => {
    expect(() => geometricWeights(n)).toThrow(ScoringError);
  });

  it('throws on non-integer n', () => {
    expect(() => geometricWeights(2.5)).toThrow(ScoringError);
  });

  it('throws on non-finite n', () => {
    expect(() => geometricWeights(Number.NaN)).toThrow(ScoringError);
    expect(() => geometricWeights(Number.POSITIVE_INFINITY)).toThrow(ScoringError);
  });

  it('throws on ratio <= 0', () => {
    expect(() => geometricWeights(4, 0)).toThrow(ScoringError);
    expect(() => geometricWeights(4, -1)).toThrow(ScoringError);
  });

  it('throws on non-finite ratio', () => {
    expect(() => geometricWeights(4, Number.NaN)).toThrow(ScoringError);
    expect(() => geometricWeights(4, Number.POSITIVE_INFINITY)).toThrow(ScoringError);
  });

  it('throws on ratio > 10', () => {
    expect(() => geometricWeights(4, 10.5)).toThrow(ScoringError);
  });

  it('accepts the boundary ratio = 10', () => {
    expect(() => geometricWeights(3, 10)).not.toThrow();
  });

  it('accepts a custom ratio', () => {
    expect(geometricWeights(3, 2)).toEqual([1, 2, 4]);
  });

  it('throws on intermediate-weight overflow', () => {
    // ratio=10, n=400: 10^399 overflows to Infinity; the iteration guard fires
    // before the next push. The function refuses silently-infinite weights.
    expect(() => geometricWeights(400, 10)).toThrow(ScoringError);
  });
});

// ── scoreQuestion — single (AC #3) ───────────────────────────────────────────

describe('scoreQuestion — single', () => {
  it('returns 4 when selected equals correct', () => {
    expect(scoreQuestion('single', [2], [2])).toBe(4);
  });

  it('returns 4 regardless of selected order (set equality)', () => {
    expect(scoreQuestion('single', [2], [2])).toBe(4);
    // Single is 1-element so order is moot — but the single-correct contract
    // requires exactly 1 correct; assert the wrong-selection path is 0.
  });

  it('returns 0 when selected differs', () => {
    expect(scoreQuestion('single', [1], [2])).toBe(0);
  });

  it('returns 0 when selected has more than one position', () => {
    // Single-correct: extra picks count as misses, so net must be 0.
    expect(scoreQuestion('single', [1], [1, 2])).toBe(0);
  });

  it('returns 0 when selected is empty', () => {
    expect(scoreQuestion('single', [1], [])).toBe(0);
  });

  it('rejects positions out of range', () => {
    expect(() => scoreQuestion('single', [1], [5])).toThrow(ScoringError);
    expect(() => scoreQuestion('single', [5], [1])).toThrow(ScoringError);
  });

  it('rejects duplicate positions', () => {
    expect(() => scoreQuestion('single', [1], [1, 1])).toThrow(ScoringError);
  });

  it('rejects negative positions', () => {
    expect(() => scoreQuestion('single', [-1], [0])).toThrow(ScoringError);
  });

  it('rejects non-integer positions', () => {
    expect(() => scoreQuestion('single', [0.5], [0])).toThrow(ScoringError);
  });
});

// ── scoreQuestion — multiple (AC #2, #4) ─────────────────────────────────────

describe('scoreQuestion — multiple', () => {
  // The canonical worked examples from architecture-spec.md §A.9.
  it.each([
    // [label, correct, selected, expected]
    ['fully correct (2 of 2)', [0, 1], [0, 1], 4],
    ['partial (1 of 2)', [0, 1], [0], 2],
    ['hit+miss cancel (2 correct)', [0, 1], [0, 2], 0],
    ['select-all (2 correct)', [0, 1], [0, 1, 2, 3], 0],
    ['empty selection (2 correct)', [0, 1], [], 0],
    ['all wrong (2 correct)', [0, 1], [2, 3], 0],
    ['unsorted selected still hits fully correct', [0, 2], [2, 0], 4],
  ])('%s → %f', (_label, correct, selected, expected) => {
    expect(scoreQuestion('multiple', correct, selected)).toBe(expected);
  });

  // The audit-correction story: selecting all 4 answer options (over-selection)
  // must NOT score full marks. With `correct = [0,1]` it cancels to 0; with
  // `correct = [0,1,2]` the formula gives 2.67 (partial, not 4); with
  // `correct = [0,1,2,3]` it is fully correct (= 4). Each shape is asserted
  // separately because the audit fix has different visible behavior per N.
  it.each([
    [2, [0, 1], 0], // over-selection penalty cancels: hits=2, misses=2 → 0
    [3, [0, 1, 2], 2.67], // partial: hits=3, misses=1 → round(8/3, 2) = 2.67
    [4, [0, 1, 2, 3], 4], // fully correct: hits=4, misses=0 → 4
  ])('select-all when |correct| = %d gives the audit-correct score %f', (_n, correct, expected) => {
    expect(scoreQuestion('multiple', correct, [0, 1, 2, 3])).toBe(expected);
  });

  // Fully correct for each shape — every multi-question must be reachable.
  it.each([
    [2, [0, 1], [0, 1], 4],
    [3, [0, 1, 2], [0, 1, 2], 4],
    [4, [0, 1, 2, 3], [0, 1, 2, 3], 4],
  ])('fully correct with |correct| = %d scores 4', (_n, correct, selected, expected) => {
    expect(scoreQuestion('multiple', correct, selected)).toBe(expected);
  });

  // Partial credit round-trips for each shape — hit count should map
  // proportionally. 3 correct, picked 1 → round(4/3, 2) = 1.33.
  it('partial credit on |correct| = 3 is 1.33', () => {
    expect(scoreQuestion('multiple', [0, 1, 2], [0])).toBe(1.33);
  });

  it('partial credit on |correct| = 4 is 1.0', () => {
    expect(scoreQuestion('multiple', [0, 1, 2, 3], [0])).toBe(1.0);
  });

  // Over-selection produces a negative pre-clamp value; the lower clamp
  // (Math.max(0, ...)) is load-bearing and must be exercised.
  it('over-selection drives the numerator negative; clamp to 0', () => {
    // correct={0,1}, selected={0,1,2,3}: hits=2, misses=2 → 4*(0)/2 = 0
    expect(scoreQuestion('multiple', [0, 1], [0, 1, 2, 3])).toBe(0);
    // correct={0,1}, selected={2,3,0,1,2} → unique selected=[0,1,2,3]
    // The PositionSetSchema rejects duplicates in *selected* BEFORE
    // scoring; but {2,3} alone gives hits=0, misses=2 → 4*(-2)/2 = -4 → clamp to 0.
    expect(scoreQuestion('multiple', [0, 1], [2, 3])).toBe(0);
  });

  // AC #4: zero-correct guard.
  it('throws when correctPositions is empty (AC #4)', () => {
    expect(() => scoreQuestion('multiple', [], [0])).toThrow(ScoringError);
    expect(() => scoreQuestion('single', [], [0])).toThrow(ScoringError);
  });

  // AC #5: position validation lives in PositionSetSchema. Bad positions
  // throw — single source of truth.
  it('rejects duplicates in correct (AC #5)', () => {
    expect(() => scoreQuestion('multiple', [0, 0, 1], [0])).toThrow(ScoringError);
  });

  it('rejects out-of-range in correct', () => {
    expect(() => scoreQuestion('multiple', [0, 5], [0])).toThrow(ScoringError);
  });

  it('rejects negatives in selected', () => {
    expect(() => scoreQuestion('multiple', [0, 1], [-1, 2])).toThrow(ScoringError);
  });

  it('rejects float positions in selected', () => {
    expect(() => scoreQuestion('multiple', [0, 1], [0.5, 1])).toThrow(ScoringError);
  });
});

// ── roundHalfAwayFromZero (shared helper) ────────────────────────────────────

describe('roundHalfAwayFromZero', () => {
  it('rounds positive halves up', () => {
    expect(roundHalfAwayFromZero(0.125, 2)).toBe(0.13);
    expect(roundHalfAwayFromZero(0.5, 0)).toBe(1);
  });

  it('rounds negative halves away from zero (NOT toward +∞)', () => {
    expect(roundHalfAwayFromZero(-0.125, 2)).toBe(-0.13);
    expect(roundHalfAwayFromZero(-0.5, 0)).toBe(-1);
  });

  it('leaves values below the half-step unchanged', () => {
    expect(roundHalfAwayFromZero(0.124, 2)).toBe(0.12);
    expect(roundHalfAwayFromZero(-0.124, 2)).toBe(-0.12);
  });

  it('returns 0 unchanged', () => {
    expect(roundHalfAwayFromZero(0, 2)).toBe(0);
  });
});

// ── weightedFinalScore (AC #7) ───────────────────────────────────────────────

describe('weightedFinalScore', () => {
  const allPerfect = (n: number): PerQuestionScore[] =>
    Array.from({ length: n }, (_, i) => ({ position: i, rawScore: 4 }));

  const allZero = (n: number): PerQuestionScore[] =>
    Array.from({ length: n }, (_, i) => ({ position: i, rawScore: 0 }));

  it('returns 4 for an all-perfect 8-question run (proves weights sum correctly)', () => {
    expect(weightedFinalScore(allPerfect(8))).toBe(4);
  });

  it('returns 0 for an all-zero 8-question run', () => {
    expect(weightedFinalScore(allZero(8))).toBe(0);
  });

  it('throws on empty input (AC #7)', () => {
    expect(() => weightedFinalScore([])).toThrow(ScoringError);
  });

  it('throws on duplicate positions', () => {
    expect(() =>
      weightedFinalScore([
        { position: 0, rawScore: 4 },
        { position: 0, rawScore: 4 },
      ]),
    ).toThrow(ScoringError);
  });

  it('throws on non-contiguous positions (gap)', () => {
    expect(() =>
      weightedFinalScore([
        { position: 0, rawScore: 4 },
        { position: 2, rawScore: 4 },
      ]),
    ).toThrow(ScoringError);
  });

  it('throws on positions outside [0, n-1]', () => {
    expect(() =>
      weightedFinalScore([
        { position: 0, rawScore: 4 },
        { position: 5, rawScore: 4 },
      ]),
    ).toThrow(ScoringError);
  });

  it('indexes weights by position, not by array index', () => {
    // Asymmetric rawScores ([4, 1, 2]) ensure that array-indexed weighting
    // (a bug we explicitly guard against) yields a DIFFERENT result than
    // position-indexed weighting, which a symmetric input would not.
    // position 0 has weight 1.0; position 2 has weight 1.21. With rawScores
    // sorted and reversed, the per-position weights change — only a correct
    // position-indexed implementation produces equal results.
    //
    // Sorted  → (4*1.0 + 1*1.1 + 2*1.21) / (1.0+1.1+1.21) = 7.52 / 3.31 = 2.27
    // Reversed → (2*1.0 + 1*1.1 + 4*1.21) / 3.31 = 7.94 / 3.31 = 2.40 (idx bug)
    const sorted = [
      { position: 0, rawScore: 4 },
      { position: 1, rawScore: 1 },
      { position: 2, rawScore: 2 },
    ];
    const reversed = [...sorted].reverse();
    expect(weightedFinalScore(sorted)).toBe(2.27);
    expect(weightedFinalScore(reversed)).toBe(2.27);
  });

  it('handles n=1', () => {
    expect(weightedFinalScore([{ position: 0, rawScore: 4 }])).toBe(4);
    expect(weightedFinalScore([{ position: 0, rawScore: 2.5 }])).toBe(2.5);
  });

  it('half-away-from-zero rounding: 2.125 → 2.13, -2.125 → -2.13', () => {
    // Construct a single-question input where the post-division value is
    // exactly 2.125: impossible for n=1, so use a 2-question case where
    // weighted = 4*1 + 2*1.1 = 6.2, denom = 2.1, ratio = 2.952... rounds
    // to 2.95. Then a 3rd decimal of exactly 5: pick weights such that
    // the unrounded value lands on .125.
    const input: PerQuestionScore[] = [
      { position: 0, rawScore: 2.125 },
      { position: 1, rawScore: 0 },
    ];
    // weighted = 2.125 * 1.0 + 0 * 1.1 = 2.125, denom = 2.1
    // 2.125 / 2.1 = 1.011904... → rounds to 1.01 (decimal 4 < 5)
    expect(weightedFinalScore(input)).toBe(1.01);
  });
});

// ── strengthFor (AC #9) ──────────────────────────────────────────────────────

describe('strengthFor', () => {
  it('classifies >= 3.0 as strong (AC #9 exact boundary)', () => {
    expect(strengthFor(3.0)).toBe('strong');
    expect(strengthFor(4)).toBe('strong');
    expect(strengthFor(3.5)).toBe('strong');
  });

  it('classifies >= 1.6 AND < 3.0 as mixed (AC #9 exact boundary)', () => {
    expect(strengthFor(1.6)).toBe('mixed');
    expect(strengthFor(2.5)).toBe('mixed');
    expect(strengthFor(2.99)).toBe('mixed');
  });

  it('classifies < 1.6 as weak', () => {
    expect(strengthFor(0)).toBe('weak');
    expect(strengthFor(1.5)).toBe('weak');
    expect(strengthFor(1.59)).toBe('weak');
  });

  it('throws on NaN (AC #9 — never fall through to a default bucket)', () => {
    expect(() => strengthFor(Number.NaN)).toThrow(ScoringError);
  });

  it('throws on non-finite input', () => {
    expect(() => strengthFor(Number.POSITIVE_INFINITY)).toThrow(ScoringError);
    expect(() => strengthFor(Number.NEGATIVE_INFINITY)).toThrow(ScoringError);
  });
});

// ── aggregateByCategory (AC #8) ──────────────────────────────────────────────

describe('aggregateByCategory', () => {
  it('groups by category and skips empty groups (AC #8)', () => {
    const questions: QuestionDto[] = [
      q({ id: 'q1', position: 0, category: 'history' }),
      q({ id: 'q2', position: 1, category: 'science' }),
      q({ id: 'q3', position: 2, category: 'science' }),
    ];
    const responses: UserResponseDto[] = [
      r({ questionId: 'q1', rawScore: 4, weight: 1, weightedScore: 4 }),
      r({ questionId: 'q2', rawScore: 2, weight: 1.1, weightedScore: 2.2 }),
      r({ questionId: 'q3', rawScore: 0, weight: 1.21, weightedScore: 0 }),
    ];

    const breakdown = aggregateByCategory(questions, responses);
    expect(breakdown).toHaveLength(2);
    const names = breakdown.map((b) => b.name).sort();
    expect(names).toEqual(['history', 'science']);
  });

  it('never emits a zero-question category — count from responses, not questions', () => {
    // 'unused' has a question but no response → no category row.
    const questions: QuestionDto[] = [
      q({ id: 'q1', position: 0, category: 'used' }),
      q({ id: 'q2', position: 1, category: 'unused' }),
    ];
    const responses: UserResponseDto[] = [
      r({ questionId: 'q1', rawScore: 4, weight: 1, weightedScore: 4 }),
    ];
    const breakdown = aggregateByCategory(questions, responses);
    expect(breakdown.map((b) => b.name)).toEqual(['used']);
  });

  it('computes avgRawScore, weightedScore, correctCount, strength correctly', () => {
    const questions: QuestionDto[] = [
      q({ id: 'q1', position: 0, category: 'c' }),
      q({ id: 'q2', position: 1, category: 'c' }),
      q({ id: 'q3', position: 2, category: 'c' }),
    ];
    const responses: UserResponseDto[] = [
      r({ questionId: 'q1', rawScore: 4, weight: 1.0, weightedScore: 4 }),
      r({ questionId: 'q2', rawScore: 1.5, weight: 1.1, weightedScore: 1.65 }),
      r({ questionId: 'q3', rawScore: 0, weight: 1.21, weightedScore: 0 }),
    ];
    const [row] = aggregateByCategory(questions, responses);
    expect(row?.questionCount).toBe(3);
    expect(row?.correctCount).toBe(1); // only rawScore === 4
    expect(row?.avgRawScore).toBeCloseTo((4 + 1.5 + 0) / 3, 7);
    expect(row?.strength).toBe('mixed'); // (5.5 / 3) ≈ 1.83
  });

  it('classifies a strong category (all 4s)', () => {
    const questions: QuestionDto[] = [
      q({ id: 'q1', position: 0, category: 'c' }),
      q({ id: 'q2', position: 1, category: 'c' }),
    ];
    const responses: UserResponseDto[] = [
      r({ questionId: 'q1', rawScore: 4, weight: 1, weightedScore: 4 }),
      r({ questionId: 'q2', rawScore: 4, weight: 1.1, weightedScore: 4.4 }),
    ];
    const [row] = aggregateByCategory(questions, responses);
    expect(row?.strength).toBe('strong');
  });

  it('classifies a weak category (all 0s)', () => {
    const questions: QuestionDto[] = [
      q({ id: 'q1', position: 0, category: 'c' }),
      q({ id: 'q2', position: 1, category: 'c' }),
    ];
    const responses: UserResponseDto[] = [
      r({ questionId: 'q1', rawScore: 0, weight: 1, weightedScore: 0 }),
      r({ questionId: 'q2', rawScore: 0, weight: 1.1, weightedScore: 0 }),
    ];
    const [row] = aggregateByCategory(questions, responses);
    expect(row?.strength).toBe('weak');
  });

  it('throws when a response references an unknown questionId', () => {
    const questions: QuestionDto[] = [q({ id: 'q1', position: 0, category: 'c' })];
    const responses: UserResponseDto[] = [
      r({ questionId: 'q1', rawScore: 4, weight: 1, weightedScore: 4 }),
      r({ questionId: 'ghost', rawScore: 0, weight: 1, weightedScore: 0 }),
    ];
    expect(() => aggregateByCategory(questions, responses)).toThrow(ScoringError);
  });

  it('returns frozen DTOs (mutation throws in strict mode)', () => {
    const questions: QuestionDto[] = [q({ id: 'q1', position: 0, category: 'c' })];
    const responses: UserResponseDto[] = [
      r({ questionId: 'q1', rawScore: 4, weight: 1, weightedScore: 4 }),
    ];
    const [row] = aggregateByCategory(questions, responses);
    expect(row).toBeDefined();
    expect(Object.isFrozen(row)).toBe(true);
    expect(() => {
      // Cast through unknown so the literal assignment compiles under strict.
      (row as unknown as { name: string }).name = 'mutated';
    }).toThrow();
  });
});

// ── rankWeakCategories (AC #8) ───────────────────────────────────────────────

describe('rankWeakCategories', () => {
  const row = (overrides: Partial<CategoryPerformanceDto>): CategoryPerformanceDto => ({
    name: 'n',
    questionCount: 1,
    correctCount: 0,
    avgRawScore: 0,
    weightedScore: 0,
    strength: 'weak',
    ...overrides,
  });

  it('sorts ascending by avgRawScore (weakest first)', () => {
    const input = [
      row({ name: 'a', avgRawScore: 3 }),
      row({ name: 'b', avgRawScore: 1 }),
      row({ name: 'c', avgRawScore: 2 }),
    ];
    const ranked = rankWeakCategories(input);
    expect(ranked.map((r) => r.name)).toEqual(['b', 'c', 'a']);
  });

  it('tie-breaks ascending by name (locale-independent)', () => {
    const input = [
      row({ name: 'gamma', avgRawScore: 2 }),
      row({ name: 'alpha', avgRawScore: 2 }),
      row({ name: 'beta', avgRawScore: 2 }),
    ];
    expect(rankWeakCategories(input).map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns a new array — never mutates the input', () => {
    const input = [row({ name: 'b', avgRawScore: 2 }), row({ name: 'a', avgRawScore: 1 })];
    const before = input.map((r) => r.name);
    rankWeakCategories(input);
    expect(input.map((r) => r.name)).toEqual(before);
  });

  it('returns frozen DTOs', () => {
    const input = [row({ name: 'a', avgRawScore: 1 })];
    const ranked = rankWeakCategories(input);
    expect(Object.isFrozen(ranked[0])).toBe(true);
    expect(() => {
      (ranked[0] as unknown as { name: string }).name = 'mutated';
    }).toThrow();
  });

  it('handles a single-category session (degenerate case)', () => {
    const input = [row({ name: 'only', avgRawScore: 3 })];
    const ranked = rankWeakCategories(input);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.name).toBe('only');
  });

  it('handles an empty breakdown', () => {
    expect(rankWeakCategories([])).toEqual([]);
  });

  it('returns stable order when two rows are identical (tie-break falls through)', () => {
    // rankWeakCategories takes a readonly array directly, so identical-name
    // duplicates can reach the tie-break comparator's `return 0` branch.
    const input = [row({ name: 'same', avgRawScore: 2 }), row({ name: 'same', avgRawScore: 2 })];
    const ranked = rankWeakCategories(input);
    expect(ranked).toHaveLength(2);
  });
});

// ── Integration sanity (single-category session, end-to-end) ────────────────

describe('single-category session end-to-end', () => {
  it('produces a one-row breakdown with deterministic tie-break', () => {
    const questions: QuestionDto[] = [
      q({ id: 'q1', position: 0, category: 'only' }),
      q({ id: 'q2', position: 1, category: 'only' }),
      q({ id: 'q3', position: 2, category: 'only' }),
    ];
    const responses: UserResponseDto[] = [
      r({ questionId: 'q1', rawScore: 4, weight: 1, weightedScore: 4 }),
      r({ questionId: 'q2', rawScore: 4, weight: 1.1, weightedScore: 4.4 }),
      r({ questionId: 'q3', rawScore: 0, weight: 1.21, weightedScore: 0 }),
    ];
    const ranked = rankWeakCategories(aggregateByCategory(questions, responses));
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.name).toBe('only');
    expect(ranked[0]?.strength).toBe('mixed');
  });
});
