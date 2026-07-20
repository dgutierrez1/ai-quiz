# Story 2.5: Category feasibility search & stratified draw

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want my quiz drawn evenly across the document's knowledge areas,
so that my per-category scores rest on comparable evidence rather than one lucky question.

## Acceptance Criteria

1. **Availability map.** Given the validated question pool handed off by Story 2.4, a `category → available count` map is built from the **valid** pool only, and availabilities are sorted descending `a₁ ≥ … ≥ a_m` (`m` = number of distinct categories present in the valid pool; `m ≤ 8` because Story 2.4's prompt caps pool tags at 8; `m ≥ 2` is guaranteed by Story 2.4's shortfall ladder, which fails the pool before handoff if fewer than 2 distinct categories survive validation). [Source: epics.md#Story-2.5; spine#AD-N4 step 3]

2. **Feasibility predicate.** For a candidate category count `C`, taking the top-`C` categories by availability, let `k = floor(Q/C)` and `r = Q mod C`. Then:
   `feasible(C) ⟺ a_C ≥ k AND (r = 0 OR a_r ≥ k+1)`
   **Every** `C` in `[2, min(8, m)]` is evaluated — this is an exhaustive search (≤7 candidates), never a decrement-until-feasible loop. Prefer a uniformly random feasible `C` in `[4,6]`; if none in that range is feasible, pick uniformly at random among whatever `C` in the full range **is** feasible. `C` is independent of `questionCount` — the search must never couple category count to question count. [Source: epics.md#Story-2.5; spine#AD-N4 step 3]

3. **Non-monotonicity proof (regression fixture #1).** With `Q=8` and availabilities `5,1,1,1,1,1,1,1` (`m=8`), no `C` in `[2,6]` is feasible, but `C=8` is (`k=1, r=0`, every `a_i ≥ 1`). This proves feasibility is **non-monotone in `C`**, so a decrementing rule can never reach the correct answer — a test must assert both the negative result for `C∈[2,6]` and the positive result for `C=8`. [Source: epics.md#Story-2.5; spine#AD-N4 step 3]

4. **Sufficiency proof (regression fixture #2).** With `Q=7, C=3, a=3,3,1`, the superseded predicate `Σ min(aᵢ, ⌈Q/C⌉) ≥ Q` incorrectly passes (`3+3+1=7 ≥ 7`) even though no legal 3-2-2 split exists (the third category has only 1 available, but a 3-way split of 7 needs `k=⌊7/3⌋=2` from every one of the 3 selected categories). The correct predicate in AC #2 must reject this case (`a_3=1 ≥ k=2` is false). A test must assert the correct predicate returns infeasible here. [Source: epics.md#Story-2.5; spine#AD-N4 step 3]

5. **Q-decrement floor.** If no `C` in `[2, min(8,m)]` is feasible at the current `Q`, decrement `Q` by 1 and re-run the full search (AC #2) at the smaller `Q`, down to a floor of **`Q = 5`**. A `Q` reduced below the originally requested `questionCount` reuses Story 2.4's `actualCount` mechanism (the session still returns `ready`, not `failed`). If no `Q` in `[5, requestedQuestionCount]` yields a feasible `C`, the selection fails — this is a **second, distinct path to `status='failed'`**, alongside Story 2.4's pool-validation shortfall ladder (see Dev Notes → Scope boundary and → Cross-story gap). [Source: epics.md#Story-2.5; spine#AD-N4 step 3]

6. **Feasibility holds before drawing.** The chosen `(Q, C, selectedCategories)` triple must satisfy `feasible(C)` at that `Q` before any question is drawn — the draw step never has to fall back or retry mid-draw. [Source: epics.md#Story-2.5]

7. **Stratified draw.** Given a feasible `(Q, C, selectedCategories)`, draw `Q` questions from the valid pool **evenly across the `C` selected categories**: each category receives `floor(Q/C)` or `ceil(Q/C)` questions, so per-category counts differ by at most 1. A count of **0 is permitted** for a selected category when `Q < C` (e.g. 5 questions across 6 selected categories → `1,1,1,1,1,0`). [Source: epics.md#Story-2.5; spine#AD-N4 step 3]

8. **Naive draw rejected.** A test fixture that performs an unstratified random draw across the whole pool (ignoring category strata) must be shown to violate AC #7 (it can concentrate questions in one category) — i.e. the test suite proves the naive approach fails where the stratified implementation passes. [Source: epics.md#Story-2.5; spine#AD-N4 step 3]

9. **Deterministic ordering & positions.** The draw's internal ordering (which of the `a_C` available questions per category get picked, and the order in which drawn questions are laid out before position assignment) is deterministic given a fixed seed/RNG — i.e. the same `(validPool, Q, seed)` input always produces byte-identical output, which is what makes the algorithm unit-testable. Positions `0..Q-1` are assigned to the drawn set only **after** the draw completes. [Source: epics.md#Story-2.5; spine#AD-N4 step 3]

## Tasks / Subtasks

- [ ] **Task 1 — Availability map + sort** (AC: #1)
  - [ ] Implement `buildAvailabilityMap(validPool: readonly PoolQuestionLike[]): Map<string, number>` counting occurrences of each `category` value in the valid pool.
  - [ ] Implement a helper that returns availabilities sorted descending as `[category, count][]`, ties broken deterministically (e.g. ascending by category name) so the top-`C` selection is reproducible.

- [ ] **Task 2 — Feasibility predicate + exhaustive search** (AC: #2, #3, #4, #6)
  - [ ] Implement `feasible(sortedAvailabilities, Q, C): boolean` exactly per AC #2's formula — `k = Math.floor(Q/C)`, `r = Q % C`, check `a_C ≥ k` and `(r === 0 || a_r ≥ k+1)` over the **top-`C`** entries.
  - [ ] Implement `searchFeasibleC(sortedAvailabilities, Q, m, rng): number | undefined` — evaluate every `C` in `[2, Math.min(8, m)]` (never decrement-and-stop), collect all feasible `C`, then pick per AC #2's preference rule ([4,6] first, else any feasible) using the injected RNG.
  - [ ] Write the two regression fixtures from AC #3 and AC #4 as table-driven unit tests before wiring the search into the draw — these are the load-bearing correctness proofs for this story.

- [ ] **Task 3 — Q-decrement loop with floor 5** (AC: #5, #6)
  - [ ] Implement the outer loop: for `Q` from `requestedQuestionCount` down to `5`, call `searchFeasibleC`; on the first feasible hit, stop and return `{ Q, C, selectedCategories }`.
  - [ ] If no `Q` in `[5, requestedQuestionCount]` yields a feasible `C`, return a typed failure result (do **not** throw a generic `Error`; see Dev Notes → Error contract) rather than silently returning `undefined`.
  - [ ] Assert the returned `(Q, C)` satisfies `feasible` immediately before it is used to draw (a cheap invariant check, not a retry).

- [ ] **Task 4 — Stratified draw + position assignment** (AC: #7, #8, #9)
  - [ ] Implement `stratifiedDraw(validPool, selectedCategories, Q, rng): PoolQuestionLike[]` — compute per-category quota (`floor(Q/C)` for all, `+1` for `Q mod C` of them, chosen deterministically e.g. by availability-sorted order), then draw that many questions per category from the valid pool using the injected RNG for which specific questions are picked and for shuffle order.
  - [ ] Assign `position = 0..Q-1` to the drawn set only after the full draw is assembled — do **not** interleave position assignment with per-category drawing.
  - [ ] Write a unit test asserting per-category drawn counts differ by ≤ 1 and that a naive `pool.slice(0, Q)`-style unstratified draw fails this same assertion on a skewed fixture (AC #8).
  - [ ] Write a unit test asserting `Q < C` produces at least one category with a 0 count while every selected category still appears in `selectedCategories` (AC #7's "0 permitted" clause).

- [ ] **Task 5 — Public entry point + types** (AC: all)
  - [ ] Compose Tasks 1–4 into one exported function, e.g. `selectCategoriesAndDraw(validPool, requestedQuestionCount, opts?: { floor?: number; rng?: () => number }): CategorySelectionResult` (see Dev Notes → Interface contract for the exact result shape) — this is the single entry point Story 2.4/2.6's orchestration (`GenerateQuizUseCase`) calls.
  - [ ] Default `floor` to `5` and `rng` to a non-seeded source (e.g. `Math.random`) in production; tests always inject a fixed seeded `rng`.

- [ ] **Task 6 — Full Vitest suite** (AC: all)
  - [ ] Place tests under `apps/api/test/domain/quiz/services/category-selection.service.spec.ts` (pure domain-service unit tests — no DB, no HTTP, no NestJS bootstrap).
  - [ ] Cover: AC #3 and AC #4 fixtures verbatim; `Q<C` zero-count case; `Q≥C` even split (`floor`/`ceil` differ by ≤1); the Q-decrement floor-5 failure path (construct a pool where no `Q∈[5,8]` has a feasible `C`); determinism (same seed ⇒ identical output across two invocations); the naive-draw-fails-stratification proof (AC #8); `m` at its extremes (`m=2`, `m=8`).
  - [ ] Run `pnpm --filter @ai-quiz/api test` before marking the story done.

## Dev Notes

### Scope boundary (read first — sibling Epic 2 stories are being authored concurrently)

This story owns **exactly** AD-N4 step 3: category feasibility search + stratified draw, as a **pure, I/O-free domain algorithm**. It is the smallest of the three-way split of the original Story 2.4 (see epics.md's 2026-07-19 split note). Do **not** pull in work that belongs to its siblings:

- **NOT this story — Story 2.4 (generate & validate the pool):** the LLM call itself, prompt construction, the `ceil(questionCount × 1.5)` pool sizing, per-question Zod shape validation (4 answers, single=1/multiple=2-4 correct), grounding + secret-shaped-token checks, and the **pool-regeneration retry ladder** (`V < 5` or `< 2` categories → retry the LLM call → `UntrustedLlmOutputError`). This story receives an **already-validated** pool as input and never calls an LLM or re-validates question shape.
- **NOT this story — Story 2.6 (persist, failure state, enrichment):** writing `quiz_sessions`/`questions`/`answers` rows, writing the `status='failed'` row in its own separately-committed transaction, composing the final HTTP response, and `async enrich(...)`. This story returns an **in-memory result** (drawn questions + selected category list + actual `Q` used, or a typed failure); it never touches Drizzle, a transaction, or `SET LOCAL app.user_id`.
- **NOT this story — `packages/shared` (Story 1.2):** the scoring functions (`scoreQuestion`, `weightedFinalScore`, `aggregateByCategory`, `rankWeakCategories`, `strengthFor`) and their Zod schemas already exist there and are untouched by this story. This story does not score anything — it only decides _which_ questions make it into the quiz and in what category distribution.
- **NOT this story — Story 3.1's `knowledge_categories` writer:** this story selects categories for the _quiz_, not for the _post-submit aggregate table_. `SubmitAnswersUseCase` remains the sole writer of `knowledge_categories` rows (AD-16). Nothing here inserts into that table.

If implementing this story reveals that `GenerateQuizUseCase` (the class that stitches 2.4 → 2.5 → 2.6 together) doesn't exist yet because Story 2.4 hasn't landed, **stub the call site with the interface in "Interface contract" below** rather than guessing at 2.4's internals — the contract, not the caller's implementation, is what this story is responsible for getting right.

### Cross-story gap to flag (do not silently resolve)

Story 2.6's acceptance criteria (epics.md) name **"Story 2.4's shortfall ladder"** as "the single authority" for reaching `status='failed'`, and enumerate only the `V < 5` / `< 2` categories path. **This story introduces a second, independent path to `failed`**: AC #5 above — no feasible `Q` in `[5, requestedQuestionCount]` even after exhausting the `C` search at every `Q`. Story 2.6 must catch _this_ story's typed failure result too, not only Story 2.4's `UntrustedLlmOutputError`. Implement this story's failure as its own discriminated result (see "Interface contract"), and leave a clear TODO / comment at the call site noting that Story 2.6 needs a second catch clause. Do not paper over the gap by silently reusing `UntrustedLlmOutputError` inside this story — throwing from a pure function makes it untestable as a pure value and hides the second failure path from whoever wires 2.6.

### Interface contract (recommended shape — no source document names this type; this is this story's design decision)

```ts
// apps/api/src/domain/quiz/services/category-selection.service.ts

interface PoolQuestionLike {
  readonly category: string;
  // ...remaining validated-pool-question fields, opaque to this algorithm.
  // Story 2.4 owns the exact pool-question DTO name/shape; this algorithm
  // only ever reads `.category` off each element and passes the rest through
  // untouched in the returned `drawnQuestions` array.
}

interface CategorySelectionSuccess<T extends PoolQuestionLike> {
  readonly ok: true;
  readonly actualCount: number; // Q actually used (== requested unless decremented)
  readonly categoryCount: number; // C
  readonly selectedCategories: readonly string[]; // the chosen category set (persisted by 2.6)
  readonly drawnQuestions: readonly T[]; // length === actualCount, NOT yet position-assigned
}

interface CategorySelectionFailure {
  readonly ok: false;
  readonly reason: 'CATEGORY_SELECTION_INFEASIBLE';
}

type CategorySelectionResult<T extends PoolQuestionLike> =
  CategorySelectionSuccess<T> | CategorySelectionFailure;

function selectCategoriesAndDraw<T extends PoolQuestionLike>(
  validPool: readonly T[],
  requestedQuestionCount: number,
  opts?: { floor?: number; rng?: () => number },
): CategorySelectionResult<T>;
```

Position assignment (`0..Q-1`) is deliberately **not** done inside `drawnQuestions` — that is a thin final step (map index → position) that the caller (2.6, at persistence time) or a one-line wrapper in this module can apply; keep the core algorithm's output order-stable and let the caller decide exactly where positions get stamped onto DB rows.

### Architecture patterns and constraints

- **Pure domain service, no I/O.** Per `project-context.md#Architecture-Rules`: "Use-cases orchestrate ports + domain services. Domain services are pure functions." This algorithm has zero dependencies beyond its inputs and an injectable RNG — no Drizzle, no NestJS decorators, no `@Injectable()`. `apps/api/src/domain/` must not import `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, or `node:fetch` (ESLint `no-restricted-imports`, AD-2) — this module trivially satisfies that since it needs none of them. [Source: AGENTS.md#Hexagonal-architecture; spine#AD-1, AD-2]
- **File placement.** `apps/api/src/domain/quiz/services/category-selection.service.ts`, alongside the forward-referenced `ScoringService` / `CategoryAggregatorService` in the spine's minimal source tree (`domain/quiz/services/`). Naming follows Consistency Conventions: kebab-case file, camelCase exported functions. [Source: spine#Consistency-Conventions; spine#Minimal-source-tree]
- **Why not `packages/shared`:** `packages/shared` is scoped to Zod schemas + the scoring module + shared types (per the repo layout and Story 1.2's explicit scope guard — "do not build [consumers] here"). This algorithm is generation-time domain logic tightly coupled to the pool/category model that Story 2.4 defines API-side; it is not a cross-cutting scoring primitive consumed by both `apps/api` and `apps/web`. Keep it in `apps/api/src/domain/`.
- **Determinism vs. randomness — do not conflate with Story 2.4's determinism rule.** Story 2.4's chunk-selection determinism (same document ⇒ same chunk budget) is unrelated to this story's draw randomness. This story's requirement is the opposite shape: the **production** draw should vary across sessions (AD-N4: "replay value comes from randomness across sessions, not within one" — a session's _own_ re-reads must return the identical persisted quiz, which Story 2.6 guarantees by persisting once, not by this algorithm being non-random). The **testability** requirement is that the function is a pure, deterministic map from `(validPool, Q, rng)` to output — inject the RNG as a parameter (default `Math.random` in production, a fixed seeded generator in tests) rather than reaching for a global random source, so tests can assert byte-identical output for a fixed seed. No source document names a specific PRNG library; a small inline seeded generator (e.g. mulberry32) or a fixed-array "next value" stub for tests is sufficient — do not add a new dependency for this.
- **`m ≥ 2` precondition.** Story 2.4's shortfall ladder guarantees the valid pool handed to this story has at least 2 distinct categories (otherwise 2.4 itself regenerates/fails before handoff). This story does not need to re-check that precondition defensively beyond an assertion — but do add one assertion (not a silent `undefined` return) since a violated precondition here indicates a bug in the 2.4/2.5 handoff, not a normal failure mode.
- **`selectedCategories` persistence gap (open, not this story's job to close).** The spine flags an open item: "AD-N4 and AD-16 both require persisting the selected-category set, but the ERD defines no column for it" (spine `Deferred` table, gate N9). This story must still **return** `selectedCategories` in its result (Story 2.6 needs it to know which categories were _selected_ even if one drew 0 questions — see AC #7's 0-count case, which is unrecoverable from `questions.category` alone once persisted). Whether/how Story 2.6 persists that list (new column vs. derived) is explicitly **out of scope here** — do not add a migration or a `quiz_sessions` column from this story.

### Testing standards

- **Location:** `apps/api/test/domain/quiz/services/category-selection.service.spec.ts` (Vitest). This is a pure-function unit test suite — no Postgres, no NestJS `TestingModule`, no HTTP. [Source: project-context.md#Testing-Rules — "integration tests in apps/api/test/"; this is the unit-test-shaped exception within that same package, analogous to how `packages/shared/test/scoring.test.ts` unit-tests pure functions]
- **Coverage floor:** this module falls under the general "use-cases ≥ 80%" floor from NFR-4 (it is domain logic invoked by a use-case, not the use-case class itself, but the same floor is the right bar given it is pure and fully testable — aim higher, since a pure module with no I/O should be able to reach the 95% bar Story 1.2 held its scoring module to).
- **Required fixtures (do not skip):** both AC #3 and AC #4 counter-examples **verbatim** — these are the two audited proofs that a naive predicate/decrement approach was rejected during planning (see epics.md revision log: "AD-N4 feasibility rule corrected (was refuted)"). Regressing either fixture silently reintroduces a refuted design.
- **Vitest run order in CI:** `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test && pnpm --filter @ai-quiz/web test:e2e` — this story's tests run in the second stage. [Source: spine#AD-N10]

### Project Structure Notes

Files this story creates (all **NEW** — no existing code in this area yet; Stories 2.1–2.4 land ingestion/chunking/LLM-adapter/pool-generation first but this module has no dependency on their concrete implementations beyond the `PoolQuestionLike` shape):

```
apps/api/src/domain/quiz/services/
  category-selection.service.ts        # NEW — this story's entire surface
apps/api/test/domain/quiz/services/
  category-selection.service.spec.ts   # NEW — full Vitest suite
```

**Alignment:** matches the spine's `domain/quiz/services/` bucket for pure quiz domain services. **Variance:** the spine's minimal source tree only names `ScoringService, CategoryAggregatorService (pure)` explicitly in that directory (both forward references to later stories); this story adds `category-selection.service.ts` to the same directory, which is additive and does not conflict with anything documented.

**Dependency:** this story needs Story 2.4's validated-pool shape to exist conceptually (at minimum: an array of objects each carrying a non-empty `category: string`), but does **not** need Story 2.4's code to be merged first — build against the `PoolQuestionLike` structural type in "Interface contract" and let Story 2.4's actual DTO satisfy that shape structurally (TypeScript structural typing means no import coupling is required either way). If Story 2.4 has already landed by the time this story is implemented, prefer importing its real pool-question type over redefining `PoolQuestionLike`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.5-Category-feasibility-search-and-stratified-draw]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-2-Generate-a-grounded-quiz-from-any-URL] (epic boundary note, split note on Story 2.4)
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.4-Generate-the-question-pool] (handoff contract: validated pool, shortfall ladder, `actualCount`)
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.6-Persist-the-quiz-failure-state-and-enrichment] (persistence + failure-write responsibilities; cross-story gap noted above)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-N4-FR-2-FR-3-Question-pool-plus-stratified-category-selection] (step 3 — the authoritative algorithm, both counter-examples, the 0-count rule, the deterministic-ordering rule)
- [Source: .../ARCHITECTURE-SPINE.md#AD-16-Multi-answer-scoring] (single-writer rule for `knowledge_categories`; `avgRawScore` vs `weightedScore` comparison rule — context, not implemented here)
- [Source: .../ARCHITECTURE-SPINE.md#Deferred] (gate N9 — selected-category-set persistence, open; gate N4 — total sync latency budget, open, relevant if the Q-decrement loop is ever found to add material latency — it should not, since it makes no LLM calls)
- [Source: .../ARCHITECTURE-SPINE.md#Consistency-Conventions] (naming: kebab-case files, camelCase functions)
- [Source: .../ARCHITECTURE-SPINE.md#AD-N10-Testing-discipline] (coverage floors, CI run order)
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.7-Agent-Flows] (step 7 — category selection + stratified sampling restated at implementation-spec level)
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.4-Repo-Layout], [#Minimal-source-tree] (`domain/quiz/services/` placement)
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-2] (superseded prose — see Open Questions #1 below; do not implement from this section)
- [Source: _bmad-output/project-context.md#Architecture-Rules] ("Use-cases orchestrate ports + domain services. Domain services are pure functions.")
- [Source: _bmad-output/implementation-artifacts/1-2-scoring-engine-in-packages-shared-fully-tested.md] (sibling pure-module precedent: scope-boundary framing, frozen-DTO style, table-driven Vitest pattern, and its own "open questions" section format, mirrored here)

### Open questions / spec gaps (resolve-in-place decisions taken above)

1. **PRD `FR-2` prose is stale on category-selection mechanics and conflicts with the spine's corrected `AD-N4`.** The PRD (`prd.md#FR-2`, "Category selection (system-side, post-call)") still describes the **refuted pre-correction design**: "the system randomly picks 4–6 categories present in the valid pool" with a hard clamp when fewer than 4 are available and a `400 DOC_TOO_SHORT` when fewer than 2 are available. This is superseded by the spine's `AD-N4` (amended 2026-07-19) and by this epic's own Story 2.5 ACs, which use the feasibility-search algorithm in AC #2 (never a random 4–6 pick, never a clamp, never a `DOC_TOO_SHORT` from this step) — epics.md's own revision log confirms this explicitly: _"AD-N4 feasibility rule corrected (was refuted)."_ **Decision applied:** this story implements the corrected `AD-N4`/epics.md algorithm, not the PRD's FR-2 prose. Flagging per `AGENTS.md`'s "stop and surface the conflict" instruction — the PRD document itself needs a sync pass to bring FR-2's prose in line with the corrected AD-N4, independent of this story's implementation.
2. **Second `failed` path is not named in Story 2.6's ACs.** See "Cross-story gap to flag" above — Story 2.6, as currently scoped in epics.md, only cites Story 2.4's shortfall ladder as the route to `status='failed'`. This story's Q-decrement-exhausted case is a second route that Story 2.6 must also catch. Not resolved here since it is Story 2.6's surface to update; flagged for whoever implements or reviews 2.6.
3. **`selectedCategories` persistence column is undecided** (spine gate N9, open). This story returns the list; Story 2.6 decides where it lives (new `quiz_sessions` column vs. some derived representation). Not resolved here.
4. **No PRNG/seed mechanism is named anywhere in the planning corpus** beyond "deterministic given the seed." **Decision applied:** inject an `rng: () => number` parameter (default `Math.random` in production, a fixed seeded stub in tests) rather than adding a PRNG dependency or a literal numeric "seed" parameter — this satisfies the stated requirement (reproducible given a fixed generator) without over-specifying a mechanism no source document chose.
5. **Tie-break for equal availabilities in the descending sort (AC #1) is unspecified.** No source document defines what happens when two categories have equal counts. **Decision applied**, mirroring Story 1.2's precedent for `rankWeakCategories`: ascending by category name as the secondary sort key, for determinism.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
