// packages/shared/src/scoring.ts
//
// Pure scoring + aggregation module (Story 1.2). No I/O, no LLM, no logging,
// no HTTP. The only external dependency is Zod, used here only for input
// validation via `PositionSetSchema`. Everything else is plain math.
//
// Invariants (DO NOT REVERT, see story AC #2/#3 + spine AD-16):
//   • multi-answer: clamp(round(4 * (hits − misses) / |correct|, 2), 0, 4)
//   • single:       4 iff sets equal, else 0
//   • select-all    → 0  (hits − misses == 0; lower clamp load-bearing)
//   • wrong picks cancel right picks
//   • 8-question geometric weights sum to 11.4358881 (NOT 12.0)
//   • categories compare by avgRawScore, NOT weightedScore (position-biased)
//   • strengthFor(NaN) throws — never falls through to a default bucket
//
// Float equality trap (AC #6): see the test for the 11.4358881 assertion
// using BOTH `toBeCloseTo(..., 7)` AND `Number(sum.toFixed(7))`.

import {
  type CategoryPerformanceDto,
  CategoryPerformanceSchema,
  PositionSetSchema,
  type QuestionDto,
  type UserResponseDto,
} from './schemas.js';

// Re-export DTO types so consumers can `import { QuestionDto, ... } from
// '@ai-quiz/shared/scoring'` (the package's main entry re-exports these via
// `./dto.ts`, but tests import from the module directly).
export type { CategoryPerformanceDto, QuestionDto, UserResponseDto };

// ── Rounding (shared by scoreQuestion and weightedFinalScore) ────────────────
//
// JavaScript's `Math.round` rounds half **up** (toward +∞), which is wrong
// for negatives (Math.round(-0.5) === -0). Both scoring entry points need
// half-away-from-zero rounding — share one helper to keep them honest.

export const roundHalfAwayFromZero = (x: number, dp: number): number => {
  if (x === 0) return 0;
  const f = 10 ** dp;
  return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f;
};

// ── Domain error type ────────────────────────────────────────────────────────
//
// All invalid inputs in this module throw a `ScoringError` so callers (use-
// cases in Story 3.1) can distinguish domain violations from programmer
// mistakes without sniffing stack traces.

export class ScoringError extends Error {
  public override readonly name = 'ScoringError';

  public constructor(message: string) {
    super(message);
  }
}

// ── Geometric weights (AC #6) ────────────────────────────────────────────────

export const geometricWeights = (n: number, ratio = 1.1): number[] => {
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ScoringError(`geometricWeights: n must be a finite integer, got ${String(n)}`);
  }
  if (n <= 0) {
    throw new ScoringError(`geometricWeights: n must be > 0, got ${n}`);
  }
  if (!Number.isFinite(ratio)) {
    throw new ScoringError(`geometricWeights: ratio must be finite, got ${String(ratio)}`);
  }
  if (ratio <= 0) {
    throw new ScoringError(`geometricWeights: ratio must be > 0, got ${ratio}`);
  }
  if (ratio > 10) {
    throw new ScoringError(`geometricWeights: ratio must be <= 10, got ${ratio}`);
  }

  const out: number[] = [];
  let w = 1;
  for (let i = 0; i < n; i += 1) {
    out.push(w);
    if (i < n - 1) {
      const next = w * ratio;
      if (!Number.isFinite(next)) {
        throw new ScoringError(`geometricWeights: weight overflow at i=${i + 1}, ratio=${ratio}`);
      }
      w = next;
    }
  }
  return out;
};

// ── scoreQuestion (AC #2, #3, #4, #5) ────────────────────────────────────────

export const scoreQuestion = (
  type: 'single' | 'multiple',
  correctPositions: number[],
  selectedPositions: number[],
): number => {
  // AC #5: position validation lives in `PositionSetSchema` — single source
  // of truth. We delegate here and let Zod produce the error message; throw
  // a ScoringError so the boundary is consistent.
  try {
    PositionSetSchema.parse(correctPositions);
    PositionSetSchema.parse(selectedPositions);
  } catch (cause) {
    throw new ScoringError(`scoreQuestion: invalid position arrays (${(cause as Error).message})`);
  }

  // AC #4: zero-correct guard.
  if (correctPositions.length <= 0) {
    throw new ScoringError('scoreQuestion: correctPositions must contain at least one position');
  }

  if (type === 'single') {
    // Set-equality comparison — order does not matter.
    const correct = new Set(correctPositions);
    if (selectedPositions.length !== correct.size) return 0;
    for (const p of selectedPositions) {
      if (!correct.has(p)) return 0;
    }
    return 4;
  }

  // multi-answer: hits ∩ correct, misses = selected \ correct.
  const correctSet = new Set(correctPositions);
  let hits = 0;
  let misses = 0;
  for (const p of selectedPositions) {
    if (correctSet.has(p)) {
      hits += 1;
    } else {
      misses += 1;
    }
  }
  const raw = roundHalfAwayFromZero((4 * (hits - misses)) / correctPositions.length, 2);
  // Clamp: the LOWER clamp is load-bearing (over-selection produces a
  // negative pre-clamp value); the upper clamp is float-safety only.
  return Math.max(0, Math.min(4, raw));
};

// ── weightedFinalScore (AC #7) ───────────────────────────────────────────────

export type PerQuestionScore = { rawScore: number; position: number };

export const weightedFinalScore = (
  perQuestion: readonly PerQuestionScore[],
  ratio = 1.1,
): number => {
  if (perQuestion.length === 0) {
    throw new ScoringError('weightedFinalScore: perQuestion must not be empty');
  }

  // Defend the contiguous-position invariant (FR-17 guarantees it upstream,
  // but the pure function refuses to silently misbehave on garbage input).
  const n = perQuestion.length;
  const seen = new Set<number>();
  for (const entry of perQuestion) {
    if (!Number.isInteger(entry.position) || entry.position < 0 || entry.position >= n) {
      throw new ScoringError(
        `weightedFinalScore: position ${entry.position} out of range [0, ${n - 1}]`,
      );
    }
    if (seen.has(entry.position)) {
      throw new ScoringError(`weightedFinalScore: duplicate position ${entry.position}`);
    }
    seen.add(entry.position);
  }

  // Index weights BY position, never by array index — caller may pass unsorted.
  // Compute the weight at each validated position directly from the formula
  // `ratio^position` (no array lookup → no `T | undefined` from
  // `noUncheckedIndexedAccess`).
  let weighted = 0;
  let denom = 0;
  for (const entry of perQuestion) {
    const w = ratio ** entry.position;
    weighted += entry.rawScore * w;
    denom += w;
  }

  return roundHalfAwayFromZero(weighted / denom, 2);
};

// ── strengthFor (AC #9) ──────────────────────────────────────────────────────

export type Strength = CategoryPerformanceDto['strength'];

export const strengthFor = (avgRawScore: number): Strength => {
  if (!Number.isFinite(avgRawScore)) {
    throw new ScoringError(`strengthFor: avgRawScore must be finite, got ${String(avgRawScore)}`);
  }
  if (avgRawScore >= 3.0) return 'strong';
  if (avgRawScore >= 1.6) return 'mixed';
  return 'weak';
};

// ── aggregateByCategory + rankWeakCategories (AC #8) ─────────────────────────

export const aggregateByCategory = (
  questions: readonly QuestionDto[],
  responses: readonly UserResponseDto[],
): CategoryPerformanceDto[] => {
  const byId = new Map<string, QuestionDto>();
  for (const q of questions) {
    byId.set(q.id, q);
  }

  // Group responses by their question's category. Skip categories with zero
  // questions (AC #8) — they would compute avgRawScore = 0/0 = NaN, and a
  // NaN would slip past every `>=` check in strengthFor and land in a
  // arbitrary bucket. We catch that here by never emitting such a row.
  //
  // The unknown-questionId check happens INSIDE the loop — single source of
  // truth, single throw site. (Pre-validating in a separate function would
  // duplicate the check and leave an unreachable `if (!q)` branch under
  // `noUncheckedIndexedAccess: true`.)
  const groups = new Map<string, UserResponseDto[]>();
  for (const r of responses) {
    const q = byId.get(r.questionId);
    if (!q) {
      throw new ScoringError(
        `aggregateByCategory: response references unknown questionId "${r.questionId}"`,
      );
    }
    const bucket = groups.get(q.category) ?? [];
    bucket.push(r);
    groups.set(q.category, bucket);
  }

  const out: CategoryPerformanceDto[] = [];
  for (const [name, group] of groups) {
    // The construction above guarantees every group has at least one
    // response (responses is non-empty by construction), so questionCount
    // is always > 0 here — no need to defend against empty groups.
    const questionCount = group.length;

    let rawSum = 0;
    let correctCount = 0;
    let weightedSum = 0;
    let weightDenom = 0;
    for (const r of group) {
      rawSum += r.rawScore;
      if (r.rawScore === 4) {
        correctCount += 1;
      }
      weightedSum += r.weightedScore;
      weightDenom += r.weight;
    }

    const avgRawScore = rawSum / questionCount;
    const weightedScore = weightedSum / weightDenom;

    const dto = CategoryPerformanceSchema.parse({
      name,
      questionCount,
      correctCount,
      avgRawScore,
      weightedScore,
      strength: strengthFor(avgRawScore),
    });
    out.push(Object.freeze(dto));
  }

  return out;
};

export const rankWeakCategories = (
  breakdown: readonly CategoryPerformanceDto[],
): CategoryPerformanceDto[] => {
  // Deterministic order: ascending by avgRawScore, tie-broken ascending by
  // name using locale-independent `<` / `>` (the spec calls this out as a
  // resolve-in-place decision in §"Open questions / spec gaps" #1).
  const sorted = [...breakdown].sort((a, b) => {
    if (a.avgRawScore !== b.avgRawScore) {
      return a.avgRawScore - b.avgRawScore;
    }
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
  // Re-validate + freeze on the way out so callers can mutate-safely.
  return sorted.map((dto) => Object.freeze(CategoryPerformanceSchema.parse(dto)));
};
