---
status: in-progress
slug: 1-2-scoring-engine-in-packages-shared-fully-tested
baseline_revision: 73c0a27
started: 2026-07-20
review_loop_iteration: 0
---

# Story 1.2: Scoring engine in `packages/shared` (fully tested)

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the pure scoring + aggregation module implemented and exhaustively unit-tested,
so that grading is provably correct before any API or UI consumes it.

## Acceptance Criteria

1. **Exports.** `packages/shared/src/scoring.ts` exports `geometricWeights`, `scoreQuestion`, `weightedFinalScore`, `aggregateByCategory`, `rankWeakCategories`, `strengthFor`, operating over frozen Zod-inferred DTOs from `packages/shared/src/schemas.ts`. [Source: epics.md#Story-1.2; architecture-spec.md#A.9]

2. **Multi-answer scoring.** For `type='multiple'`: `raw = clamp(round(4 × (hits − misses) / |correct|, 2), 0, 4)` where `hits = |correct ∩ selected|`, `misses = |selected \ correct|`. Fully-correct → 4, empty → 0, hit+miss → 0, **select-all → 0**, verified across 2-correct, 3-correct and 4-correct shapes. [Source: spine#AD-16]

3. **Single scoring.** For `type='single'`: raw = 4 iff the selected set equals the correct set, else 0. [Source: spine#AD-16]

4. **Zero-correct guard.** `scoreQuestion` throws when `|correct| ≤ 0`. [Source: spine#AD-16]

5. **Position validation.** A `selected` (or `correct`) array containing duplicates or out-of-range positions (e.g. `[0, 0, 5]`) is rejected — positions must be **unique integers in `[0, 3]`**. [Source: epics.md#Story-1.2; spine#AD-16]

6. **Geometric weights.** `geometricWeights(n, ratio = 1.1)` returns `[1.0, 1.1, 1.21, …]`; for `n = 8` the weights sum to exactly **11.4358881** (not 12.0). Throws if `n <= 0`, `n` is not an integer, `ratio <= 0`, `ratio` is not finite, or `ratio > 10`. [Source: architecture-spec.md#A.9]

7. **Weighted final score.** `weightedFinalScore(perQuestion, ratio = 1.1)` = `Σ(rawᵢ × wᵢ) / Σ(wᵢ)`, rounded **half-away-from-zero** to 2 decimals, over **contiguous positions `0..n−1`**. Throws on an empty array and on non-contiguous/duplicate positions. [Source: architecture-spec.md#A.9; spine#AD-N5]

8. **Category aggregation.** `aggregateByCategory` returns `CategoryPerformanceDto[]` in which categories compare by **`avgRawScore`** (never `weightedScore` — position-biased and not comparable across categories), and **a category with zero questions is never emitted** (avoids `0/0 = NaN`). [Source: spine#AD-16]

9. **Strength thresholds.** `strengthFor(avgRawScore)` → `>= 3.0` strong, `>= 1.6 && < 3.0` mixed, `< 1.6` weak. The exact boundary values **3.0** and **1.6** are covered by explicit tests and classify as `strong` and `mixed` respectively. `strengthFor(NaN)` must not fall through to an arbitrary bucket — it throws. [Source: spine#AD-16]

10. **Coverage gate.** Vitest coverage for the scoring module is **≥ 95%**, enforced by a Vitest coverage threshold that runs inside `pnpm verify`, covering: `n = 0 / 1 / 8`, all-correct, all-wrong, select-all → 0, hit+miss cancel, negative-before-clamp, NaN guard, rounding boundary, single-category sessions, deterministic tie-breaks. [Source: epics.md#Story-1.2; spine#AD-N10]

## Tasks / Subtasks

- [ ] **Task 1 — Scoring-relevant Zod schemas in `packages/shared/src/schemas.ts`** (AC: #1, #5)
  - [ ] Add `AnswerPositionSchema = z.number().int().min(0).max(3)`.
  - [ ] Add `PositionSetSchema` = array of `AnswerPositionSchema`, `.refine()`-ing uniqueness (this is the single place AC #5 is enforced — do not duplicate the check in `scoring.ts`).
  - [ ] Add `QuestionSchema` (`id`, `sessionId`, `position`, `text` `.max(500)`, `type: z.enum(['single','multiple'])`, `category`, `explanation`) and `UserResponseSchema` (`questionId`, `selected: PositionSetSchema`, `rawScore`, `weight`, `weightedScore`) mirroring the ERD columns in `architecture-spec.md#A.4`.
  - [ ] Add `CategoryPerformanceSchema`: `{ name, questionCount, correctCount, avgRawScore, weightedScore, strength: z.enum(['strong','mixed','weak']) }` — field-for-field mirror of the `knowledge_categories` table.
  - [ ] Export `z.infer` types (`QuestionDto`, `UserResponseDto`, `CategoryPerformanceDto`). **The type IS the schema** — no hand-written interfaces.
  - [ ] `packages/shared/src/dto.ts` re-exports the frozen DTO types; `packages/shared/src/index.ts` re-exports `schemas` + `scoring` + `dto`.
  - [ ] ⚠️ Scope guard: add **only** the schemas this story's functions consume. `QuizSessionSchema`, chat, document and LLM-output schemas belong to Stories 1.3/1.4 and Epic 2 — do not pre-build them.

- [ ] **Task 2 — `geometricWeights`** (AC: #6)
  - [ ] `geometricWeights(n: number, ratio = 1.1): number[]` → `wᵢ = ratio^i` for `i` in `0..n−1`.
  - [ ] Throw a domain error on `n <= 0`, non-integer `n`, `ratio <= 0`, non-finite `ratio`, `ratio > 10`.
  - [ ] Compute by repeated multiplication or `Math.pow` — pick one and keep it; the `n=8` sum must equal `11.4358881` under the module's own rounding assertion (see Dev Notes → float equality).

- [ ] **Task 3 — `scoreQuestion`** (AC: #2, #3, #4)
  - [ ] Signature: `scoreQuestion(type: 'single' | 'multiple', correctPositions: number[], selectedPositions: number[]): number`.
  - [ ] Validate both arrays through `PositionSetSchema` first; throw on invalid.
  - [ ] Throw when `correctPositions.length <= 0`.
  - [ ] `single`: return 4 iff the sets are equal (compare as **sets**, not array order), else 0.
  - [ ] `multiple`: `hits = |correct ∩ selected|`; `misses = |selected \ correct|`; `raw = clamp(roundHalfAwayFromZero(4 * (hits − misses) / correct.length, 2), 0, 4)`.
  - [ ] ⚠️ The **lower clamp is load-bearing** (over-selection drives the numerator negative). The upper clamp is float-safety only. Do not remove either.

- [ ] **Task 4 — `weightedFinalScore`** (AC: #7)
  - [ ] Signature: `weightedFinalScore(perQuestion: { rawScore: number; position: number }[], ratio = 1.1): number`.
  - [ ] Throw on empty input.
  - [ ] Assert positions are unique and contiguous over `0..n−1`; throw otherwise (FR-17 guarantees this upstream, but the pure function still defends it).
  - [ ] `Σ(rawScoreᵢ × weights[positionᵢ]) / Σ(weights)`, then round half-away-from-zero to 2 dp. Index weights **by `position`, never by array index** — the caller may pass an unsorted array.

- [ ] **Task 5 — `aggregateByCategory`, `rankWeakCategories`, `strengthFor`** (AC: #8, #9)
  - [ ] `strengthFor(avgRawScore: number)`: throw on `NaN`/non-finite; `>= 3.0` → `strong`; `>= 1.6` → `mixed`; else `weak`.
  - [ ] `aggregateByCategory(questions: readonly QuestionDto[], responses: readonly UserResponseDto[]): CategoryPerformanceDto[]` — group responses by their question's `category`; per group compute `questionCount`, `correctCount` (**count a question correct iff `rawScore === 4`** — see Dev Notes, spec gap #2), `avgRawScore = Σ rawScore / questionCount`, `weightedScore` (weighted mean over the group's global positions), and `strength = strengthFor(avgRawScore)`.
  - [ ] **Skip any category with `questionCount === 0`** — never emit it (AC #8). Also throw if a response references a `questionId` absent from `questions`.
  - [ ] `rankWeakCategories(breakdown: readonly CategoryPerformanceDto[]): CategoryPerformanceDto[]` — sort ascending by `avgRawScore`; tie-break **ascending by `name` (locale-independent `<`/`>` comparison)** so the order is deterministic. Return a new array; never mutate the input.
  - [ ] Return `Object.freeze(...)`-wrapped DTO objects, consistent with the frozen-DTO rule (AD-3).

- [ ] **Task 6 — Vitest suite + coverage gate** (AC: #10)
  - [ ] Write `packages/shared/test/scoring.test.ts` covering every case listed in AC #10 plus: `single` with a 2-element `selected`, unsorted `selected`, `n=1`, all-wrong, negative-before-clamp, rounding boundary (a value whose 3rd decimal is exactly 5), single-category session, and both `strengthFor` boundaries.
  - [ ] Add an explicit test asserting `geometricWeights(8).reduce(sum) === 11.4358881` (to the module's stated precision).
  - [ ] Add `vitest.config.ts` in `packages/shared` with `coverage.thresholds` `{ lines: 95, functions: 95, branches: 95, statements: 95 }` scoped to `src/scoring.ts`, and `coverage.provider: 'v8'`.
  - [ ] Wire `pnpm --filter @ai-quiz/shared test` to run with `--coverage` so the threshold is enforced inside `pnpm verify` (`lint:check && typecheck && test && test:e2e && build`).
  - [ ] Run `pnpm --filter @ai-quiz/shared test` and `pnpm verify` before marking the story done.

## Dev Notes

### Scope boundary (read first)

This story is **pure functions + schemas only**. `packages/shared` has **no I/O, no NestJS, no Drizzle, no HTTP**. The consumers (`SubmitAnswersUseCase`, `CategoryAggregatorService`, the result UI) land in Story 3.1 and Epic 3 — do **not** build them here, and do not add a `SubmitResponse` assembler.

`knowledge_categories` **rows** are written by exactly one component, `SubmitAnswersUseCase` (Story 3.1). This story produces the _values_; it never persists them. [Source: spine#AD-16 single-writer rule]

### Architecture patterns and constraints

- **Hexagonal / purity.** `packages/shared` is imported by both `apps/api` (domain layer) and `apps/web`. Anything non-pure added here would be transitively imported into `apps/api/src/domain/`, which ESLint `no-restricted-imports` forbids from touching `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, `node:fetch`. Keep the module dependency-free apart from `zod`. [Source: spine#AD-1, AD-2; project-context.md#Architecture-Rules]
- **Zod is the single source of truth.** The same schema in `packages/shared/src/schemas.ts` validates DB rows on read, HTTP bodies on write, and LLM JSON. Write the schema once; derive the type with `z.infer`. **No parallel hand-written interfaces** — that is the #1 drift risk in this package. [Source: spine#AD-3; architecture-spec.md#A.3]
- **Frozen DTOs.** `Object.freeze` returned DTO objects. Under `strict` mode, mutation throws — this is deliberate. [Source: PRD#NFR-9]
- **`noUncheckedIndexedAccess: true` is on.** Every `arr[i]` is `T | undefined`. Expect the compiler to reject naive indexing in `weightedFinalScore` and `geometricWeights` — handle it with an explicit guard/throw, **not** with `!` non-null assertions.
- **Naming conventions.** kebab-case files, camelCase functions, PascalCase types, `*.dto.ts` for DTO modules. [Source: spine#Consistency-Conventions]

### Scoring invariants — do not "simplify" these

These are audited decisions with counter-examples on record. Reverting any of them is a scoring-integrity defect, not a refactor.

- ❌ **Never** `4 × hits / |correct|`. That archived formula ignored wrong selections, so selecting all 4 options scored **full marks on every `multiple` question**. The current formula makes wrong picks cancel right picks. [Source: spine#AD-16; project-context.md#Scoring-Rules]
- ❌ **Never** sum the 8-question weights to 12. `Σ 1.1^i` for `i=0..7` is **11.4358881**. A test asserts this exact value.
- ❌ **Never** rank or compare categories by `weightedScore`. It is position-biased (a category whose questions happen to sit late in the quiz gets inflated) and therefore not comparable across categories. `avgRawScore` is the comparison key. `weightedScore` is retained as a reported column only.
- ❌ **Never** emit a zero-question category. `avgRawScore` would be `0/0 = NaN`, and a `NaN` fails every `>=` comparison, silently falling through to the last bucket in a naive `strengthFor`. This is why `strengthFor` throws on `NaN` rather than defaulting. [Source: spine#AD-16, added 2026-07-19]
- ✅ **Keep** the `empty selected → 0` branch in `scoreQuestion` even though the API rejects empty selections with 400 (AD-N5). It is pure-function robustness and is unreachable through the API — it is still tested here.

### Float equality (the trap in AC #6)

`1.1^7` computed by repeated multiplication and by `Math.pow` can differ in the last bits, and a naive `expect(sum).toBe(11.4358881)` may fail. Assert with `expect(sum).toBeCloseTo(11.4358881, 7)` **and** additionally assert the rounded value `Number(sum.toFixed(7)) === 11.4358881`. Do not "fix" a failing assertion by loosening the expected constant.

### Rounding

JavaScript's `Math.round` rounds half **up** (toward `+∞`), which is wrong for negatives (`Math.round(-0.5) === -0`). `weightedFinalScore` specifies **half-away-from-zero**. Implement one shared helper and use it in both `scoreQuestion` and `weightedFinalScore`:

```ts
const roundHalfAwayFromZero = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f;
};
```

Note `scoreQuestion`'s pre-clamp value can be negative (over-selection), which is exactly where `Math.round` would diverge. Cover this with the "negative-before-clamp" test.

### Testing standards

- **Vitest** unit tests in `packages/shared/test/scoring.test.ts`. [Source: project-context.md#Testing-Rules]
- Coverage floors project-wide: scoring **≥ 95%**, use-cases ≥ 80%, adapters ≥ 60%. Note `spine#AD-N10` aspires to _100%_ on the six scoring functions while the epic AC and NFR-4 set the **enforced** threshold at 95% — enforce 95%, aim for 100%; a pure module with no I/O should reach it.
- Vitest must complete in **< 30 s** on a single CI runner. [Source: spine#AD-N10]
- CI run order: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test && pnpm --filter @ai-quiz/web test:e2e`. Only the first applies to this story (the other two packages are empty or non-existent until Stories 1.3+).
- Table-driven (`it.each`) tests are the right shape for the `scoreQuestion` matrix — the select-all → 0 case must be asserted separately for 2-, 3-, and 4-correct questions, not just once.

### Project Structure Notes

Files this story creates (all **NEW** — the repo currently contains no source code, so there are no existing files to preserve):

```
packages/shared/
  package.json                 # name: @ai-quiz/shared
  tsconfig.json                # extends ../../tsconfig.base.json
  vitest.config.ts             # NEW — coverage thresholds for src/scoring.ts
  src/
    index.ts                   # re-exports schemas + scoring + dto
    schemas.ts                 # NEW/UPDATE — scoring-relevant Zod schemas only
    scoring.ts                 # NEW — the six exported functions
    dto.ts                     # re-exports frozen DTO types
  test/
    scoring.test.ts            # NEW — the full Vitest matrix
```

[Source: spine#Directory-Structure; architecture-spec.md#A.13 build-order step 2]

**Alignment:** matches the spine's `packages/shared` layout exactly. **Variance:** the spine's tree does not list `vitest.config.ts`; it is added here because AC #10 requires an enforced coverage threshold, which needs a config file. This is additive and does not conflict with anything.

**Dependency:** Story 1.1 (monorepo scaffold, `tsconfig.base.json`, ESLint/Prettier, root `pnpm verify`) must be complete. If `packages/shared/package.json` does not yet exist, create it as part of Task 1 rather than blocking — but do **not** re-derive root tooling config that Story 1.1 owns.

### Latest technical information

- **Zod** — use Zod 4.x (`import { z } from 'zod'`). `z.infer` and `.strict()` behave as in the spec examples. Prefer `.refine()` (not the removed `.nonstrict()`) for the uniqueness constraint on position arrays.
- **Vitest** — coverage thresholds moved under `test.coverage.thresholds` (they were top-level `coverage.lines` etc. in Vitest 0.x). Use `provider: 'v8'`; `@vitest/coverage-v8` must be a devDependency of `packages/shared` (or the root, hoisted).
- **TypeScript `~6.0.3`** (`>=6.0.3 <6.1.0`) with `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`, inherited from `tsconfig.base.json`.
  - ⚠️ **Do not install `typescript@latest`** — it resolves to **7.0.2** (Project Corsa, the Go rewrite), which ships no programmatic Compiler API until 7.1. `typescript-eslint@8.64.0` declares peer `typescript >=4.8.4 <6.1.0`, so latest breaks peer resolution and crashes ESLint. Story 1.1 pins this; do not override it.
  - TS 6.0 made `strict` a **default**, but all three flags are still set explicitly in `tsconfig.base.json` — read them from there, don't re-declare per package.
- No LLM, HTTP, or provider concerns touch this story — the provider stack (MiniMax/OpenRouter) lands in Epic 2.

### Previous story intelligence

None available. Story 1.1 is being authored in the same sprint cycle and no implementation-artifact story files or feature commits exist yet (repo contains planning artifacts only). Git history holds no implementation patterns to learn from — establish the conventions above as the baseline for later stories.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.2-Scoring-engine-in-packages-shared-fully-tested]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-1-Foundation-Security-Spine-Deployable-Skeleton]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-16-Multi-answer-scoring]
- [Source: .../ARCHITECTURE-SPINE.md#AD-3-Zod-DTOs-at-boundaries], [#AD-N5-Complete-submissions], [#AD-N10-Testing-discipline], [#Consistency-Conventions], [#Directory-Structure]
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.9-Scoring-Module-packages-shared]
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.4-Data-Model] (`questions`, `user_responses`, `knowledge_categories` columns)
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#NFR-8-10.8-Scoring], [#FR-7-SubmitResponse-shape], [#NFR-9-Canonical-adapter-pattern]
- [Source: _bmad-output/project-context.md#Scoring-Rules], [#Testing-Rules], [#Architecture-Rules]

### Open questions / spec gaps (resolve-in-place decisions taken above)

1. **`rankWeakCategories` ordering is unspecified.** No source document defines the sort key, direction, or tie-break, yet `architecture-spec.md#A.9` requires "deterministic tie-breaks" in the test list. **Decision applied:** ascending by `avgRawScore`, tie-broken ascending by `name`. Flag to the PM/architect if a different presentation order is wanted in the result UI (Story 3.2).
2. **`correctCount` semantics are undefined** for partially-scored `multiple` questions. The `knowledge_categories.correct_count` column exists but no document says whether a partial (e.g. `rawScore = 2.0`) counts. **Decision applied:** a question counts as correct iff `rawScore === 4`. Confirm before Story 3.1 persists the column.
3. **`weightedScore` per category has no defined formula.** Geometric weights are indexed by _global_ quiz position, so a per-category weighted mean is not normalized the same way as `weightedFinalScore`. **Decision applied:** weighted mean over the group's global positions (`Σ raw×w / Σ w` within the group). Low-risk because AD-16 forbids using this value for comparison — it is reported only.
4. **Coverage floor conflict:** `spine#AD-N10` says 100%, `NFR-4` and the epic AC say ≥95%. Enforced at 95% per the AC.
5. **`insights.strengthByCategory` typed as a single scalar** in the PRD's `SubmitResponse` (`'strong' | 'mixed' | 'weak'`) while the comment says "per-category" — likely should be a map or array. Not this story's surface (Story 3.1 owns `SubmitResponse`), but `CategoryPerformanceDto.strength` is the per-category truth this story provides; flag for Story 3.1.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
