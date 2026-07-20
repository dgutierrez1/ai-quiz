# Story 2.4: Generate the question pool (single structured call) & validate it

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want 5–8 grounded questions generated from my document in one LLM call,
so that I get a playable quiz quickly without off-document or injected content.

## Acceptance Criteria

_(FR-2 request contract, FR-3, FR-15 output-side, FR-16 critical path, AD-4, AD-16, AD-N1, AD-N2, AD-N4 steps 1–2)_

1. **Request contract.** Given `POST /api/sessions` with a required `strategy` (`factual|comprehension|mixed|trivia`), a `questionCount` integer in `[5,8]` (Zod-validated, default 8), and an optional `topic` (≤200 chars, hint not instruction), a session is created and `questionCount` persists to `quiz_sessions.question_count`. A missing/invalid `strategy` or a `questionCount` outside `[5,8]` returns **400**.

2. **Ownership of the pipeline's first half.** This story owns the sync critical path's first half — `fetch → neutralize → chunk → select ~8k-token budget → 1 structured LLM call (question pool) → validate pool` — ending when a validated pool exists **in memory**, with no Tavily/web search (closed-world). The remaining steps — `select categories → stratified-sample` (Story 2.5) and `persist → return` (Story 2.6) — are pure system-side work after the call returns, which is what makes the single-LLM-call constraint genuinely hold. The full end-to-end path (HTTP round trip returning `status='ready'`) is asserted **once**, in Story 2.6 — this story's own tests exercise the pipeline at the use-case level, not via HTTP.

3. **The single LLM call.** It returns a pool of `ceil(questionCount × 1.5)` questions (Q=8 → 12, Q=5 → 8), each tagged with a model-derived `category`. The prompt bounds the pool to **4–8 distinct category tags total** (a soft cardinality bound, not exact allocation) so a feasible stratified draw always exists downstream (Story 2.5). The model is **not** asked to allocate questions across categories.

4. **Per-question shape (Zod-enforced).** Every pool question has exactly 4 answers; `single` = exactly 1 correct; `multiple` = 2–4 correct; a non-empty `category` string.

5. **Pool validation precedes any selection.** Every pool question is grounding-checked and secret-shaped-token-checked before any selection occurs.

6. **Shortfall ladder (classification only).** Let `V` = valid questions surviving validation:
   - `V ≥ questionCount` → proceed at full count.
   - `5 ≤ V < questionCount` → proceed with `Q = V`, carry `actualCount = V`.
   - `V < 5`, **or** fewer than 2 distinct categories → regenerate the whole pool on the retry budget (1 strict-mode / 2 best-effort); on exhaustion raise `UntrustedLlmOutputError`.
   - This story owns the **classification and the retry**; Story 2.6 owns **writing** the resulting terminal state (`ready` + `actualCount`, or `failed`). `failed` is reachable **only** via the exhaustion branch — a shortfall above the floor of 5 is never `failed`, and `400 DOC_TOO_SHORT` is **never** emitted here (that belongs to the pre-LLM doc-size guard, Story 2.2).

7. **Retry discipline.** Provider fallback is disabled on this path (no OpenRouter→MiniMax swap mid-flight); total LLM calls are hard-capped at the retry budget (≤2 calls strict-mode, ≤3 best-effort) so the ~30s sync ceiling holds.

8. **Tracing.** Every LLM call on the generation path emits a Langfuse trace (via `TracingPort`, Story 1.6) carrying prompt, completion, latency, tokens, model, provider, cache hit/miss, `sessionId`, and `userId` — this closes the tracing deferral recorded in Story 1.6.

## Tasks / Subtasks

- [ ] **Task 1 — Extend `CreateSessionRequestSchema` to the full Epic 2 request contract** (AC: #1)
  - [ ] In `packages/shared/src/schemas.ts`, extend the **stub-only** `CreateSessionRequestSchema` Story 1.4 created (`{ sourceUrl: string().url() }`) to the full shape: `sourceUrl` (URL string), `topic` (optional, `.max(200)`, comment: "hint, never injected into the prompt as an instruction"), `strategy` (`z.enum(['factual','comprehension','mixed','trivia'])`, **required**, no default), `questionCount` (`z.number().int().min(5).max(8).default(8)`).
  - [ ] ⚠️ **Do not add `provider`/`model` fields to this schema in this story.** Story 2.3 owns the provider capability map and `GET /api/config/providers`; whether provider/model selection is validated on this same request schema or a separate one is unresolved by any source document — see _Open questions_ below. Flag it; do not guess a shape.
  - [ ] Read `packages/shared/src/schemas.ts` in full before editing — it already has Story 1.2's scoring schemas and Story 1.4's row/request schemas. Append; do not restructure.

- [ ] **Task 2 — Zod schemas for the LLM output boundary (the pool)** (AC: #3, #4)
  - [ ] Add `PoolQuestionSchema`: `{ text: z.string().max(500), type: z.enum(['single','multiple']), category: z.string().min(1), answers: z.array(z.object({ text: z.string(), isCorrect: z.boolean() })).length(4), explanation: z.string().max(2000).nullable() }`, `.strict()`, plus a `.refine()` enforcing `type='single'` ⟺ exactly 1 `isCorrect`, `type='multiple'` ⟺ 2–4 `isCorrect`. This is the **single source of truth** the LLM adapter (Story 2.3) must use to `Object.freeze(Schema.parse(raw))` the raw model JSON (AD-3) — coordinate: if 2.3 already stubbed a pool schema, reconcile to this one definition rather than duplicating.
  - [ ] Add `QuestionPoolSchema = z.array(PoolQuestionSchema)` — the raw pool as returned by the single LLM call, before any validation/selection.
  - [ ] Export `z.infer` types: `PoolQuestionDto`, `QuestionPoolDto`.
  - [ ] Do **not** add `category` cardinality (4–8 distinct tags) as a Zod constraint on the array — that is a _prompt_ instruction to the model (soft bound), not a hard schema rule; a pool that violates it is not rejected by Zod, it is handled by the shortfall ladder's "fewer than 2 distinct categories" branch (Task 5).

- [ ] **Task 3 — Domain errors** (AC: #6)
  - [ ] `apps/api/src/domain/quiz/errors/untrusted-llm-output.error.ts` — `UntrustedLlmOutputError` (extends a base domain error if one exists from earlier stories; otherwise a plain `Error` subclass). This is the **first** story to need it — `SsrfBlockedError` (2.1) and `DocTooLargeError`/`DocTooShortError` (2.2) are siblings' concerns; do not create those here.

- [ ] **Task 4 — Pure domain services: grounding check, secret-token check, chunk-budget selection** (AC: #2, #5)
  - [ ] `apps/api/src/domain/quiz/services/grounding-check.ts` — `isGrounded(question: PoolQuestionDto, sourceChunks: readonly string[]): boolean`. Reject (return `false`) when the question's `text` + all four `answers[].text` share no meaningful token overlap with **any** source chunk. "Meaningful token overlap" needs a concrete heuristic (e.g. normalize + tokenize both sides, require ≥N shared non-stopword tokens or a similarity threshold) — no source document specifies the exact algorithm; pick a defensible one (e.g. Jaccard similarity over lowercased, punctuation-stripped word sets, threshold tunable) and document the choice inline, since FR-15/AD-N1 only specify the _property_, not the implementation.
  - [ ] `apps/api/src/domain/quiz/services/secret-token-check.ts` — `hasLeakedSecret(question: PoolQuestionDto, sourceMarkdown: string): boolean`. Match `sk-[A-Za-z0-9]{20,}`, `AKIA[A-Za-z0-9]{16}`, and long high-entropy strings across `text` + `answers[].text` + `explanation`; a match is a leak **only if the matched substring is absent from `sourceMarkdown`** (present-in-source is legitimate quiz content, e.g. a quiz about API keys).
  - [ ] `apps/api/src/domain/quiz/services/select-chunk-budget.ts` — `selectChunkBudget(chunks: readonly string[], tokenBudget: number): string[]`. Deterministic given `(chunks, tokenBudget)` — feeding the same chunk array and budget twice yields a byte-identical selection (Story 2.2 already guarantees deterministic _chunking_; this function's job is deterministic _selection_ within the ~8k-token ceiling, e.g. greedy in-order accumulation until the budget is hit). Retries must **not** re-derive this differently — call it once per attempt with the same inputs (AD-N4: "determinism is scoped to chunk selection, not model sampling").
  - [ ] `apps/api/src/domain/quiz/services/classify-pool-shortfall.ts` — `classifyShortfall(validCount: number, distinctCategories: number, questionCount: number): { outcome: 'full' | 'shortfall' | 'regenerate'; q: number }`. Pure function implementing the AC #6 ladder: `full` when `validCount >= questionCount`; `shortfall` (carrying `q = validCount`) when `5 <= validCount < questionCount`; `regenerate` when `validCount < 5` or `distinctCategories < 2`.
  - [ ] All four are pure (no I/O) — domain unit tests must run in <100ms (AD-2).

- [ ] **Task 5 — `GenerateQuizUseCase` (new file — first half only)** (AC: #2, #3, #5, #6, #7, #8)
  - [ ] `apps/api/src/domain/use-cases/GenerateQuizUseCase.ts` — **NEW**. This is the **first** story to create this file; Stories 2.5 and 2.6 **extend the same file** with category selection/stratified sampling and persistence/response respectively. Do not let either sibling story create a second competing use-case file — if one already exists when you start, read it fully and extend, don't replace.
  - [ ] Orchestrates, via injected ports (constructor DI): `IngestionPort` (2.1 — fetch), a neutralize+chunk service (2.2 — likely `IngestionPort`/a dedicated port; read 2.1/2.2's artifacts at dev time for the exact port name), `selectChunkBudget` (Task 4, this story), `LlmPort.generateQuiz(...)` (2.3 — the sole outbound LLM boundary per AD-5), the pool-validation services (Task 4, this story), `classifyShortfall` (Task 4), and `TracingPort` (1.6).
  - [ ] Method shape (name it `execute` or `generatePool` — pick one and be consistent; it is **not** yet the full `GenerateQuizUseCase.execute()` that 2.6 will expose as the epic's public entry point, since this story stops before persistence): input `{ sourceUrl, strategy, questionCount, topic, provider, model, sessionId, userId }` → output `{ validPool: PoolQuestionDto[]; classification: ReturnType<typeof classifyShortfall> }` (or throws `UntrustedLlmOutputError` on exhaustion).
  - [ ] Retry loop: call `LlmPort.generateQuiz` with the **same** chunk-budget selection (deterministic) each attempt; do **not** vary the chunk selection between retries — sampling variance (temperature/seed) is the adapter's (2.3's) concern, not this use-case's. Cap total calls at the AD-4 budget by provider mode: **≤2 total for strict-mode** (default `minimax/MiniMax-M3`), **≤3 total for best-effort** (OpenRouter free). On exhaustion, throw `UntrustedLlmOutputError` — do **not** persist a `failed` row here (that write, in its own separately-committed transaction, is Story 2.6's job per AD-9's failure-state rule).
  - [ ] ⚠️ **Provider fallback must not fire on this path.** If `LlmPort` (or a wrapping adapter) implements the AD-6 OpenRouter→MiniMax transparent fallback for the chat path, this use-case must call it in a mode/flag that disables it here — verify against Story 2.3's actual `LlmPort` signature once it exists; if the port has no such flag yet, flag it as a cross-story integration gap rather than silently allowing the fallback to fire (a mid-flight model swap here changes the retry budget class and can compound to ~6 LLM calls, per AD-6).
  - [ ] Wrap each `LlmPort.generateQuiz` attempt with `TracingPort.startTrace(...)` / `recordGeneration(...)` / `flush()` (Story 1.6's port surface) — capture `sessionId`, `userId`, `provider`, `model` from the use-case's own inputs, and `latency_ms`/`tokens`/`cache_hit` from whatever the adapter's return value exposes. **This story, not Story 2.3, is responsible for calling `TracingPort`** — Story 1.6's own dev notes say tracing "lands with those calls in Stories 2.4 and 4.2," and Story 2.3's scope does not include it. If `LlmPort.generateQuiz`'s return shape doesn't yet carry latency/token/cache-hit metadata when you reach this task, that is a gap in Story 2.3 to surface, not to silently skip.
  - [ ] Run pool validation (Task 4's `isGrounded` + `hasLeakedSecret`) over **every** pool question from **each** attempt before classifying — validation happens once per attempt, on that attempt's fresh pool (never carried over from a prior failed attempt).

- [ ] **Task 6 — Wire the extended request schema into the controller (validation only)** (AC: #1)
  - [ ] Read `apps/api/src/driving/sessions/sessions.controller.ts` in full (Story 1.4 built the stub `POST /api/sessions`) before editing.
  - [ ] Swap the `ZodValidationPipe`'s schema from the 1.4 stub to this story's extended `CreateSessionRequestSchema` (Task 1) so `strategy`/`questionCount`/`topic` are validated and a malformed request 400s (AC #1).
  - [ ] Persist `strategy`, `questionCount` (with its Zod default of 8 applied), and `topic` onto the `quiz_sessions` insert alongside the existing `sourceUrl` (the columns already exist per Story 1.3's `quiz_sessions` table — no migration needed).
  - [ ] **Decision applied (scope boundary — read before touching the controller further):** this story does **not** wire the controller to invoke `GenerateQuizUseCase` synchronously, and does **not** change the HTTP response shape. The controller still returns the Story 1.4 stub shape (`{ id, status: 'pending' }`) after this story. Rationale: AC #2 states the full end-to-end HTTP path is "asserted once, in Story 2.6" — if this story also drove the use-case through the controller, either the response would be incomplete (no `status='ready'`, no questions) or this story would have to invent response shaping that's explicitly Story 2.6's to own. Keeping the controller's response unchanged and testing `GenerateQuizUseCase` **directly** (Task 7) avoids a merge conflict with 2.5/2.6 rewriting the same controller code path, and avoids this story silently committing to a response contract it doesn't own. Story 2.6 is the one that changes the controller's actual invocation + response.

- [ ] **Task 7 — Tests** (AC: all)
  - [ ] `apps/api/test/domain/grounding-check.test.ts`, `secret-token-check.test.ts`, `select-chunk-budget.test.ts`, `classify-pool-shortfall.test.ts` — pure unit tests, no I/O, <100ms each. Cover: grounded vs ungrounded question; secret-shaped token present-in-source (allowed) vs absent-from-source (rejected); deterministic chunk selection across two calls with identical inputs; all three shortfall-ladder branches (`full`, `shortfall`, `regenerate`) including the exact boundary `validCount = 5` (shortfall, not regenerate) and `validCount = questionCount` (full).
  - [ ] `apps/api/test/use-cases/generate-quiz-use-case.test.ts` — integration-style test against `GenerateQuizUseCase` with **mocked** `IngestionPort`/chunk service/`LlmPort`/`TracingPort` (do not hit real network or a real LLM). Cover: (a) full pool on first attempt → `classification.outcome === 'full'`; (b) shortfall pool (5 ≤ V < questionCount) → `outcome === 'shortfall'`, `q === V`; (c) pool with `V < 5` on every attempt through exhaustion → throws `UntrustedLlmOutputError`, and the mocked `LlmPort.generateQuiz` was called exactly the budget-capped number of times (2 for strict-mode, 3 for best-effort) — assert the call count, not just the error; (d) a pool question failing `isGrounded` or `hasLeakedSecret` is excluded before classification runs; (e) `TracingPort.startTrace`/`recordGeneration`/`flush` are called once per attempt with `sessionId`/`userId`/`provider`/`model` present.
  - [ ] `apps/api/test/integration/sessions.controller.test.ts` (extend, don't replace, whatever 1.4 already added) — HTTP-level test asserting AC #1 only: missing `strategy` → 400; `strategy` outside the enum → 400; `questionCount` of `4` or `9` → 400; `questionCount` omitted → defaults to 8 and the row persists `question_count = 8`; valid request → 201 with the **unchanged** `{ id, status: 'pending' }` stub shape (do not assert `status='ready'` or questions here — that assertion belongs to Story 2.6).
  - [ ] Coverage floor: use-cases ≥ 80% (NFR-4) — `GenerateQuizUseCase`'s new code is the primary target; the pure domain services should be near 100% given they have no I/O branches to skip.
  - [ ] Run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify` before marking done.

## Dev Notes

### Scope boundary — read first (over-implementation is the main risk on this story)

Epic 2 stories 2.1–2.7 are being written concurrently as story files, and several land in the same files. This story's slice of the sync critical path is **fetch → neutralize → chunk → select ~8k-token budget → 1 structured LLM call → validate pool**, ending with a validated pool **in memory**. Everything below is explicitly **out of scope** here, even though it is easy to reach for while sitting inside `GenerateQuizUseCase`:

| Concern                                                                                                                                                                                    | Owner                                  | Why it's tempting to build here anyway                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/sessions` SSRF-safe fetch (`ssrf-safe-fetch.ts`, IP blocklist, DNS-pin, GitHub blob→raw)                                                                                        | **Story 2.1**                          | `GenerateQuizUseCase` calls `IngestionPort`, whose implementation is 2.1's                                                                                                 |
| Neutralization (`neutralize.ts`) + heading-based chunker (`chunker.ts`) + the doc-size/content-density guard (`400 DOC_TOO_LARGE`/`DOC_TOO_SHORT`)                                         | **Story 2.2**                          | This story consumes chunks; it's tempting to also implement how they're produced                                                                                           |
| `MastraLlmAdapter`, `capabilities.ts`, the actual Mastra `generateQuiz` structured-output call, lazy SDK loading                                                                           | **Story 2.3**                          | This story is the first real consumer of `LlmPort.generateQuiz` and needs _a_ working implementation to test against                                                       |
| `GET /api/config/providers`                                                                                                                                                                | **Story 2.3**                          | Session creation superficially "needs" a provider, but provider/model selection validation is not in this story's ACs                                                      |
| Category selection, feasibility search, stratified draw                                                                                                                                    | **Story 2.5**                          | `classifyShortfall`'s `q` output looks like it wants to flow straight into a draw — resist finishing the job                                                               |
| Persisting `questions`/`answers`/selected-category-set rows, writing `status='failed'` in its own transaction, the final controller response with `status='ready'`/questions/`actualCount` | **Story 2.6**                          | The validated pool sitting in memory at the end of this story is _begging_ to be persisted — don't; 2.6 owns the write path and the AD-9 failure-transaction pattern       |
| `knowledge_categories` rows (any writer)                                                                                                                                                   | **Story 3.1** (`SubmitAnswersUseCase`) | Generation must never write these — see AD-16's single-writer rule; this story's pool has nothing to do with them anyway, noted only because it's a common cross-epic slip |

If `LlmPort`, `IngestionPort`, or the neutralize/chunk service do not exist yet when you start this story, that is a **sequencing gap to surface**, not something to build here — stub the minimum interface shape needed to compile against (matching the port signatures documented in this story's Dev Notes) and flag it, rather than implementing 2.1/2.2/2.3's actual logic.

### Architecture compliance (binding)

- **AD-1/AD-2 hexagonal + domain purity.** `GenerateQuizUseCase.ts` and everything in Task 4 live under `apps/api/src/domain/` and must import nothing from `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, `node:fetch` — only port interfaces, domain types, and Zod. All I/O happens behind the injected ports.
- **AD-3 Zod DTOs at every boundary.** `PoolQuestionSchema`/`QuestionPoolSchema` (Task 2) are this story's boundary schema for the LLM-output surface — the adapter (2.3) is the one that calls `Object.freeze(Schema.parse(raw))` with them, per the canonical adapter pattern; this story's own code only ever sees the already-parsed, frozen `QuestionPoolDto`. Do not re-parse it inside the use-case.
- **AD-4 LLM untrusted.** `safeParse` + retry budget (1 strict / 2 best-effort) is enforced at the adapter boundary for malformed JSON (2.3's concern); this story's retry loop is a **different, higher-level** retry — regenerating the whole pool when validation (grounding/secret-token) or the shortfall ladder demands it. Don't conflate the two: a JSON-parse failure retry (2.3) and a validation-shortfall retry (this story) both count toward the _same_ AD-4 total-call budget, so if 2.3's adapter already retried once internally on a parse failure, this use-case's own retry count must account for that shared ceiling — coordinate the exact call-counting contract with 2.3 rather than assuming independence.
- **AD-5 LlmPort is the sole outbound LLM boundary.** Never import `adapters/llm/*` directly from this use-case.
- **AD-6 provider fallback disabled on generation.** See Task 5's fallback-flag note — this is release-blocking per AD-6's own rationale (compounds to ~6 calls, blows the 30s ceiling).
- **AD-N1 (grounding + secret-token checks) and AD-N2 (bounded critical path, closed-world — no Tavily).** Task 4's two check functions are this story's implementation of AD-N1's output-side controls 3 and 4 specifically (the shape/plain-text-render/structured-output controls 1–2 are enforced elsewhere: Zod schema = containment; plain-text render is a Story 3.2/3.3 UI concern).
- **AD-N4 steps 1–2.** This story implements exactly steps 1 (the single call) and 2 (validate + shortfall classify + retry) of AD-N4's five-step algorithm. Step 3 (category selection + stratified sampling) is explicitly Story 2.5's — do not reach for it even though `classifyShortfall`'s output shape naturally feeds it.
- **AD-N9 observability.** `TracingPort` usage must follow Story 1.6's contract exactly — no prompt/completion bodies were sent by 1.6 itself (it had no real LLM calls yet); this story is the first to actually populate them. Metadata only, no PII beyond what 1.6's adapter already redacts (`user_id_hash`, not raw `X-User-Id`, is `TracingPort`'s concern internally — this use-case just passes `userId` through, per Story 1.6's `LangfuseAdapter.ts` which is expected to hash it).

### LLM provider — MiniMax/OpenRouter via Mastra, not the Anthropic API

This project's LLM adapter (Story 2.3) is a Mastra-based, provider-agnostic wrapper — v1 scope is **MiniMax (default `minimax/MiniMax-M3`) + OpenRouter free models only**. There is no direct Anthropic SDK usage anywhere in this codebase; Anthropic model IDs (`claude-sonnet-5`, etc.) appear in `project-context.md` only as a **deferred-to-v2, reference-only** note and must not be used here. When this story's Dev Notes or tests need a concrete model string, use `minimax/MiniMax-M3` (the default) — never an Anthropic model ID. The exact Mastra structured-output call shape (e.g. how `generateQuiz` invokes Mastra's schema-constrained generation) is Story 2.3's implementation detail inside `MastraLlmAdapter`; this story only depends on `LlmPort.generateQuiz(...)` returning an already-Zod-parsed `QuestionPoolDto`.

### `LlmPort` integration contract this story requires (reconcile with Story 2.3)

No source document pins `LlmPort.generateQuiz`'s exact signature — the architecture spec only lists the port's method names (`generateQuiz, explainAnswer, analyzeGaps, chat`). This story needs the following from it and must reconcile with whatever Story 2.3 actually ships:

```ts
interface LlmPort {
  generateQuiz(input: {
    chunks: readonly string[]; // this story's selectChunkBudget() output
    strategy: 'factual' | 'comprehension' | 'mixed' | 'trivia';
    questionCount: number; // used by the adapter to compute pool size = ceil(questionCount * 1.5)
    topic?: string;
    provider: string;
    model: string;
    disableFallback: boolean; // AD-6 — must be true on this path
  }): Promise<{
    pool: QuestionPoolDto; // already Object.freeze(QuestionPoolSchema.parse(raw)) per AD-3
    latencyMs: number;
    tokens: { input: number; output: number };
    cacheHit: boolean;
  }>;
  // explainAnswer, analyzeGaps, chat — not this story's concern
}
```

If Story 2.3's actual port differs (different field names, pool-size computed by the use-case instead of the adapter, etc.), adapt this use-case's call site to match it — do not fork a second `LlmPort` interface. Read `apps/api/src/domain/ports/LlmPort.ts` in full before writing the use-case if it already exists at dev time.

### Testing standards

- Vitest. Pure domain services and `GenerateQuizUseCase` tests live in `apps/api/test/` (never colocated in `src/`) per project convention (Story 1.3/1.4 precedent), even though AD-2 also asks that in-domain unit tests run fast — fast execution, not colocation, is the AD-2 requirement.
- Coverage floors (NFR-4/AD-N10): use-cases ≥ 80%. This story's domain services have no I/O to exempt, so aim well above the floor on those.
- No real network calls, no real LLM calls in this story's tests — everything through mocked ports. The first real end-to-end assertion (real ingestion → real LLM → real persistence) is Story 2.6's.
- Table-driven (`it.each`) tests suit the shortfall-ladder boundary cases (`validCount` at 4, 5, questionCount-1, questionCount) and the grounding/secret-token true/false matrix.

### Project Structure Notes

Files this story creates or touches:

```
packages/shared/src/schemas.ts                                     UPDATE (append PoolQuestionSchema, QuestionPoolSchema; extend CreateSessionRequestSchema)
apps/api/src/domain/
  quiz/errors/untrusted-llm-output.error.ts                        NEW
  quiz/services/
    grounding-check.ts                                             NEW
    secret-token-check.ts                                          NEW
    select-chunk-budget.ts                                         NEW
    classify-pool-shortfall.ts                                     NEW
  use-cases/GenerateQuizUseCase.ts                                 NEW (first half only — 2.5/2.6 extend)
  ports/LlmPort.ts                                                 NEW or UPDATE — read first; owned in practice by Story 2.3, but this story is a consumer that may need to author the interface if 2.3 hasn't yet
apps/api/src/driving/sessions/sessions.controller.ts                UPDATE (swap validation schema; persist strategy/questionCount/topic; response shape UNCHANGED)
apps/api/test/
  domain/grounding-check.test.ts                                   NEW
  domain/secret-token-check.test.ts                                NEW
  domain/select-chunk-budget.test.ts                                NEW
  domain/classify-pool-shortfall.test.ts                            NEW
  use-cases/generate-quiz-use-case.test.ts                          NEW
  integration/sessions.controller.test.ts                           UPDATE (extend Story 1.4's stub test with the new 400 cases)
```

Naming per spine Consistency Conventions: kebab-case files, PascalCase classes (`GenerateQuizUseCase`), `*.error.ts` for domain error classes, `*.port.ts` for ports (note: the spine's own minimal source tree lists `LlmPort.ts` in PascalCase without the `.port.ts` suffix — Story 1.4 resolved this drift in favor of kebab-case/`*.port.ts` for its own ports; follow that precedent for consistency across the repo rather than the spine's tree literally).

### Previous story intelligence

Stories 1.1–1.6 (Epic 1) are done as story files but have **no implementation code merged yet** — there is no git history or `File List` to learn from. Two Epic 1 stories are load-bearing for this one and were read in full:

- **Story 1.2** (`packages/shared` scoring + schemas) established the pattern this story must follow in `packages/shared/src/schemas.ts`: one schema per **boundary**, not per entity (AD-3's 2026-07-19 clarification) — this is exactly why `PoolQuestionSchema` (LLM-output boundary) must be a distinct schema from any future `QuestionRowSchema` (DB-row boundary), never a shared one. Also established: `Object.freeze`-wrapped DTOs, `z.infer` for types (no hand-written interfaces), and the pure-function/no-I/O bar for anything in `packages/shared` or `domain/`.
- **Story 1.6** (observability) built `TracingPort` (`apps/api/src/domain/ports/TracingPort.ts`) and `LangfuseAdapter` — interface only, zero I/O imports, no-op fallback when Langfuse env vars are absent. It explicitly deferred real LLM-call tracing to **this story and Story 4.2** — Task 5 above is what closes that deferral for the generation path. Read `TracingPort.ts`'s actual method signatures (`startTrace`, `recordGeneration`, `flush` per 1.6's suggested surface) before wiring the use-case; if 1.6 shipped a different surface, use what exists.
- Stories 1.3 (API skeleton, `quiz_sessions` table with `strategy`/`question_count`/`topic` columns already present but nullable-at-creation) and 1.4 (ownership + the stub `POST /api/sessions`/`sessions.controller.ts`/`CreateSessionRequestSchema` this story extends) are direct prerequisites — read both in full at dev time; do not re-derive their scaffolding.

No Epic 2 sibling story files (2.1/2.2/2.3/2.5/2.6/2.7) contain implementation code either — they are being authored as story files in the same sprint-planning pass as this one. Treat every port/adapter this story depends on (`IngestionPort`, the neutralize/chunk service, `LlmPort`, `MastraLlmAdapter`) as **possibly not yet implemented** when this story reaches dev — the Dev Notes above describe the contract this story needs from each; verify against what actually exists and flag drift rather than guessing silently.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.4-Generate-the-question-pool-single-structured-call--validate-it]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-2-Generate-a-grounded-quiz-from-any-URL] — epic boundary note, seam with Epic 3
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.1] [#Story-2.2] [#Story-2.3] [#Story-2.5] [#Story-2.6] — sibling scope boundaries
- [Source: .../architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-N4] — question pool + stratified selection, the shortfall ladder, chunk-selection determinism
- [Source: .../ARCHITECTURE-SPINE.md#AD-N1] — ingest neutralization + output grounding, the four output-side controls
- [Source: .../ARCHITECTURE-SPINE.md#AD-N2] — bounded critical path, closed-world generation, no map-reduce
- [Source: .../ARCHITECTURE-SPINE.md#AD-4] — LLM untrusted, retry budgets by provider mode
- [Source: .../ARCHITECTURE-SPINE.md#AD-5] — LlmPort sole outbound LLM boundary
- [Source: .../ARCHITECTURE-SPINE.md#AD-6] — provider fallback disabled on generation path, rationale (~6 call compounding)
- [Source: .../ARCHITECTURE-SPINE.md#AD-3] — Zod DTOs at every boundary, canonical adapter pattern, one-schema-per-boundary clarification
- [Source: .../ARCHITECTURE-SPINE.md#AD-N9] — observability, Langfuse metadata-only rule
- [Source: .../ARCHITECTURE-SPINE.md#Minimal-source-tree] — `GenerateQuizUseCase.ts`, `domain/quiz/{dto,entities,services,errors}/`, `domain/ports/LlmPort.ts` locations
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.7-Agent-Flows] — the 10-step generation flow (this story = steps 1–6)
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.6-REST-API] — `POST /api/sessions` request/response shapes
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-2] [#FR-3] [#FR-15] [#FR-16] — canonical FR text and rationale for the question-pool redesign
- [Source: _bmad-output/project-context.md#Quiz-generation-flow] [#Provider-rules] — closed-world generation, MiniMax/OpenRouter v1 scope
- [Source: _bmad-output/implementation-artifacts/1-2-scoring-engine-in-packages-shared-fully-tested.md] — schema-per-boundary precedent, frozen-DTO convention
- [Source: _bmad-output/implementation-artifacts/1-6-observability-and-deploy-the-skeleton.md] — `TracingPort` surface, explicit deferral of real tracing to this story
- [Source: _bmad-output/implementation-artifacts/1-3-api-skeleton-db-foundation-and-health-endpoints.md] — `quiz_sessions` columns already present
- [Source: _bmad-output/implementation-artifacts/1-4-per-session-ownership-walking-skeleton-sessions-endpoint.md] — stub `CreateSessionRequestSchema`, `sessions.controller.ts` this story extends
- [Source: claude-api skill (bundled reference)] — confirmed current Anthropic model IDs are **not applicable** to this story; project's LLM surface is Mastra→MiniMax/OpenRouter, per `project-context.md#Provider-Defaults`

### Open questions / spec gaps (flagged, not guessed)

1. **Provider/model fields on `CreateSessionRequestSchema`.** `architecture-spec.md §A.6` shows `provider`/`model` in the `POST /api/sessions` request body, but no Epic 2 story's ACs (2.3's or this one's) explicitly assign ownership of validating them against the configured provider list. This story deliberately does **not** add them to the schema it extends (Task 1) to avoid guessing a shape Story 2.3 might define differently around its capability map. Whoever implements 2.3 or 2.4 second should reconcile — if 2.3 lands first with an opinion, this story's schema extension should merge into it rather than re-diverge.
2. **Exact `LlmPort.generateQuiz` signature.** No source document specifies it beyond the method name. This story documents the contract it needs (Dev Notes above) and flags reconciliation with Story 2.3 as necessary at dev time.
3. **Grounding-check algorithm.** FR-15/AD-N1 specify the property ("no meaningful token overlap") but not the algorithm. This story picks a defensible heuristic (Task 4) and documents it inline in code — flag to the architect/PM if a different approach (e.g. embedding-similarity instead of token-overlap) is wanted before Story 4.2 (which reuses grounding concepts for chat) builds on it.
4. **AD-4's shared retry-call budget across two retry mechanisms.** AD-4's "1 retry strict / 2 best-effort" governs adapter-level JSON-parse failures (2.3); this story's shortfall-driven "regenerate the whole pool" is a second, coarser retry trigger. Architecture-spec text (§A.7 step 6, spine AD-N4 step 2) reads as if these share one total-call ceiling, but no document states how a 2.3-internal retry and a 2.4-driven retry are counted against the same budget without double-implementing retry logic in two places. Flagged for reconciliation with Story 2.3 rather than resolved unilaterally here.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
