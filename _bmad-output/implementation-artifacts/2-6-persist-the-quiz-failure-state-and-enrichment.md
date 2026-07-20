# Story 2.6: Persist the quiz, failure state & enrichment

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want my generated quiz stored and returned safely,
so that revisiting the session shows the same quiz and a failed generation shows me an error instead of vanishing.

## Acceptance Criteria

_(FR-2 persistence, FR-15 output-side, FR-16 async enrichment, AD-N1, AD-N4, AD-9, AD-16; SM-1)_

1. **Persisted once, replayed identically.** Given the completed draw (from Story 2.5), it is persisted once per session and never re-run. Re-reading the session (`GET /api/sessions/:id`) returns the identical quiz — replay value comes from randomness across sessions, not within one.
2. **Shortfall ladder is Story 2.4's alone — this story only writes the outcome.** Given an under-generating pool, Story 2.4's shortfall ladder is the single authority: `5 ≤ V < questionCount` → this story writes `status='ready'` with `actualCount`; only `V < 5` (or fewer than 2 distinct categories) reaches `failed`. The quiz is never padded with filler questions.
3. **Failure state survives the request-transaction rollback.** Given the ladder reaches `failed` (raises `UntrustedLlmOutputError` after 2.4 exhausts its retry budget), the `status='failed'` row (with `error_message`) is written in its **own, separately-committed transaction** — with its own `set_config('app.user_id', ...)` — **before** the error propagates. The request transaction (owned by `identity.interceptor.ts`) rolls back on the thrown error; without the separate transaction, the rollback erases the very row the UI renders and the session silently reverts to invisible.
4. **Success path persists questions/answers/document.** Given success, `questions` + `answers` persist without `is_correct` ever leaving the server, and a `documents` row is created — all three new tables carry `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy (depth-1 for `documents`/`questions`, depth-2 for `answers` via `questions → quiz_sessions`).
5. **`knowledge_categories` is never touched here.** Generation never inserts `knowledge_categories` rows — `SubmitAnswersUseCase` (Story 3.1) is their sole creator.
6. **Async enrichment is correctly scoped and never a correctness dependency.** `async enrich(sessionId, userId)` runs off the critical path (after the response is sent / after the request transaction commits — see Dev Notes for why timing matters), opens **its own transaction**, and issues its own `set_config('app.user_id', ...)` before any write — the request transaction has already committed, so without this every enrichment write is silently rejected by `FORCE ROW LEVEL SECURITY`. It is never a correctness dependency: if Fly auto-stop kills it mid-flight, nothing downstream breaks.
7. **Response shape.** The response (from `POST /api/sessions` and `GET /api/sessions/:id` once `status='ready'`) returns the questions (each with its 4 answers, **no `is_correct`**) plus `status='ready'` (or `status='failed'` + `error_message`). New session-scoped reads use `@OwnsSession()` and carry an ownership isolation test.
8. **SM-1 — end-to-end proof.** Generation succeeds end-to-end on the pipecat and langchain READMEs — the full pipeline (2.1 ingest → 2.2 neutralize/chunk → 2.3 provider → 2.4 pool+validate → 2.5 select+draw → this story's persist+return) is asserted **once, in this story**, per Story 2.4's own note that it does not duplicate this assertion.

### Additional acceptance criteria (derived from binding ADs / spec gaps this story must resolve — treat as equally required)

9. **New migration, RLS-complete.** A single new migration (sequential after Story 1.4's RLS migration — do not renumber or regenerate `0000`/`0001`) creates `documents`, `questions`, `answers` and applies `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + a policy to each, following the depth-1/depth-2 template Story 1.4 carried forward as documentation (see Dev Notes → RLS migration contract).
10. **`quiz_sessions.selected_categories` column added.** The spine's own Deferred log (item N9) flags that the selected-category set (which may include categories that legitimately drew 0 questions, per AD-N4) is otherwise unreconstructible from `questions.category` alone. This story adds `selected_categories jsonb` (array of strings) to `quiz_sessions` in the same migration and populates it from Story 2.5's selection output.
11. **`actualCount` is derived, not persisted.** No new column is added for it — the response computes `actualCount = questions.length` for the session and includes it in the response body only when it is less than the originally-requested `quiz_sessions.question_count`.
12. **Wire schema is distinct from the row schema.** Per AD-3's "wire ≠ row" clarification, `packages/shared/src/schemas.ts` gets `DocumentRowSchema`, `QuestionRowSchema`, `AnswerRowSchema` (internal, `AnswerRowSchema` includes `isCorrect`) **and** a separate `QuizQuestionResponseSchema` (outbound, answers projected without `isCorrect`) — dropping `is_correct` is a schema-level projection, not a runtime `delete`.
13. **`UntrustedLlmOutputError` gets an HTTP mapping.** This story adds `UntrustedLlmOutputError → 502` to whatever domain-error-to-HTTP-status registry Story 1.5's `SafeExceptionFilter` actually implements (read that file first) — no source document assigns this error a status code, and this story is the first place it can be thrown and observed end-to-end.
14. **Post-commit timing for `enrich()` is explicit.** Because `void enrich(sessionId, userId)` must run only after the request transaction has committed (its whole purpose is to open a _second_, later transaction), this story adds a minimal post-commit hook to `identity.interceptor.ts` (Story 1.4, read fully before editing) rather than calling `enrich()` from inside the use-case while the request transaction is still open. See Dev Notes → "Post-commit execution — the gap this story must close."

## Tasks / Subtasks

- [ ] **Task 1 — Shared Zod schemas** (AC: #4, #7, #10, #12)
  - [ ] In `packages/shared/src/schemas.ts` add `DocumentRowSchema` (`id`, `sessionId`, `url`, `contentMarkdown`, `contentHash`, `chunks: z.array(...)`, `byteSize`, `tokenEstimate`, `ingestedAt`), `QuestionRowSchema` (`id`, `sessionId`, `position`, `text ≤500`, `type: 'single'|'multiple'`, `category`, `explanation: string.max(2000).nullable()`), `AnswerRowSchema` (`id`, `questionId`, `position: 0..3`, `text`, `isCorrect: boolean`).
  - [ ] Add `QuizQuestionResponseSchema` — same shape as `QuestionRowSchema` plus a nested `answers: {id, position, text}[]` **with no `isCorrect` field at all** (not `isCorrect: undefined` — the field must not exist in the type). This is the schema the controller returns; do not reuse `QuestionRowSchema`/`AnswerRowSchema` on the wire.
  - [ ] Extend `QuizSessionRowSchema` (from Story 1.3/1.4) with `selectedCategories: z.array(z.string()).nullable()`. Confirm you are editing the same schema those stories defined — do not create a second `QuizSession*` schema.
  - [ ] Add a Vitest assertion (alongside Story 1.3's Drizzle↔Zod drift guard) that the new Drizzle tables' column key sets equal their Row schema key sets.

- [ ] **Task 2 — Drizzle schema + migration** (AC: #9, #10)
  - [ ] Add `documents`, `questions`, `answers` table definitions to `apps/api/src/adapters/persistence/drizzle/schema.ts` (UPDATE — Story 1.3 created this file for `users`/`quiz_sessions`; append, do not restructure). Column shapes: see Dev Notes → Data Model Contract.
  - [ ] Add `selected_categories jsonb` to the existing `quiz_sessions` table definition.
  - [ ] Generate one new migration (`pnpm db:generate`) — verify it lands as the next sequential number after Story 1.4's RLS migration (do **not** touch `0000` or `0001`).
  - [ ] Append RLS DDL to that same migration file (or `drizzle-kit`'s custom-SQL mechanism, matching how 1.4 did it): `ENABLE`+`FORCE ROW LEVEL SECURITY` on all three new tables, plus:
    ```sql
    CREATE POLICY user_documents ON documents
      USING (EXISTS (SELECT 1 FROM quiz_sessions s
                     WHERE s.id = documents.session_id
                       AND s.user_id = current_session_user_id()));

    CREATE POLICY user_questions ON questions
      USING (EXISTS (SELECT 1 FROM quiz_sessions s
                     WHERE s.id = questions.session_id
                       AND s.user_id = current_session_user_id()));

    -- Depth-2: answers has NO session_id, only question_id.
    CREATE POLICY user_answers ON answers
      USING (EXISTS (SELECT 1 FROM questions q
                     JOIN quiz_sessions s ON s.id = q.session_id
                     WHERE q.id = answers.question_id
                       AND s.user_id = current_session_user_id()));
    ```
  - [ ] `documents.session_id` is `UNIQUE` (the ERD's `quiz_sessions ||--|| documents` is one-to-one — enforce it at the schema level, not just by convention).
  - [ ] `current_session_user_id()` already exists from Story 1.4's migration — reuse it, do not redefine.
  - [ ] Verify the migration applies cleanly via `node dist/main.js migrate` against a fresh docker-compose Postgres that already has migrations `0000`/`0001` applied.

- [ ] **Task 3 — Ports + repositories (canonical adapter pattern)** (AC: #4, #7, #12)
  - [ ] Add `DocumentRepositoryPort`, extend `QuizRepositoryPort` (or add sibling ports) with `persistGeneratedQuiz(...)`, `findQuestionsForUser(sessionId, userId)`, `markSessionFailed(sessionId, userId, errorMessage)` (this last one runs on its own fresh transaction — see Task 5).
  - [ ] Drizzle repositories in `apps/api/src/adapters/persistence/drizzle/`: every read method ends `Object.freeze(RowSchema.parse(row))` / `.map(...)` (AD-3); every session-scoped query is named `forUser*` or wrapped in `assertUserOwns(sessionId, userId)` so the Story 1.4 ESLint rule `@ai-quiz/no-unscoped-session-query` passes.
  - [ ] All three tables' repository methods bind to the ALS `tx` from `identity.interceptor.ts` (Story 1.4) for the success path — never a fresh pool connection (it would not see the GUC).

- [ ] **Task 4 — Persist step in `GenerateQuizUseCase`** (AC: #1, #2, #4, #5, #7, #11)
  - [ ] This story adds the **final segment** of `apps/api/src/domain/use-cases/GenerateQuizUseCase.ts` (UPDATE — Stories 2.4/2.5 build the earlier segments of this same file; do not restructure their code, append/compose). Treat 2.4's validated-pool output and 2.5's stratified-draw output as given function signatures/return types you consume.
  - [ ] Given the drawn questions (with assigned `0..Q-1` positions from 2.5) and the selected-category set, persist: the `documents` row (content, hash, chunks, byte_size, token_estimate from 2.1/2.2's output), the `questions` + `answers` rows, and `quiz_sessions.selected_categories`.
  - [ ] Update `quiz_sessions.status` from `'pending'` to `'ready'` in the same request transaction (already opened by `identity.interceptor.ts` for this `POST /api/sessions` request).
  - [ ] `explanation` on every persisted question stays `null` in v1 — no active FR populates it (the ERD column predates the current FR set; do not wire an LLM call to fill it).
  - [ ] Compute and return `actualCount` only when `questions.length < quiz_sessions.question_count`.
  - [ ] Idempotency note: this use-case only ever runs once per session as part of the single `POST /api/sessions` request — there is no separate "re-generate" trigger in v1. Re-reads are served by `GET /api/sessions/:id`, which must never re-invoke generation.

- [ ] **Task 5 — Failure-state write on a separate transaction** (AC: #3, #13)
  - [ ] When Story 2.4's ladder raises `UntrustedLlmOutputError`, catch it at the point the use-case is about to let it propagate. Before re-throwing, open a **fresh** transaction (new pool client, not the ALS `tx`) with its own `set_config('app.user_id', userId, true)`, `UPDATE quiz_sessions SET status='failed', error_message=$1 WHERE id=$2`, commit, close the client — then re-throw so the outer request transaction still rolls back (which is fine: nothing else was written).
  - [ ] Reuse Story 1.4's `set_config(...)` pattern exactly (`SELECT set_config('app.user_id', $1, true)` inside an explicit transaction — `SET LOCAL` cannot bind parameters). If `identity.interceptor.ts` does not yet expose a "give me a fresh independent transaction" helper, add one there (small, additive) rather than hand-rolling pool access inside the use-case.
  - [ ] Add `UntrustedLlmOutputError → 502` (Bad Gateway — this is an upstream/provider failure after the retry budget is exhausted, not a client input error) to the domain-error-to-HTTP-status mapping Story 1.5's `SafeExceptionFilter` implements. Read `safe-exception.filter.ts` fully first; extend its existing registry, do not fork a second error-mapping mechanism.

- [ ] **Task 6 — `enrich(sessionId, userId)` + post-commit hook** (AC: #6, #14)
  - [ ] Add a minimal, additive extension to `identity.interceptor.ts` (Story 1.4) that lets the use-case register a post-commit callback (e.g. `getRequestContext().onCommit(fn)`), invoked by the interceptor **after** `db.transaction(...)` resolves successfully, fire-and-forget (never awaited by the response path, errors caught and logged, never surfaced to the client).
  - [ ] `enrich(sessionId, userId)`: opens its own transaction, sets its own `set_config('app.user_id', ...)`, and — in this story's scope — calls `tracingPort.flush()` (the `TracingPort` from Story 1.6) so the Langfuse trace(s) emitted by Story 2.4's LLM call are flushed before a Fly auto-stop can drop them.
  - [ ] **Do not** implement "full document + chunk persistence" or "`knowledge_categories` aggregate recomputation" inside `enrich()` for this story — see Dev Notes → "Design ruling: what `enrich()` actually does in Epic 2" for why both are out of scope here (one is already synchronous per this story's own AC #4/#7; the other is dead code until Story 3.1 exists).
  - [ ] `enrich()` must never throw into the request/response path and must never be awaited before the response is written.

- [ ] **Task 7 — `GET /api/sessions/:id` + `POST /api/sessions` response** (AC: #7)
  - [ ] Update `sessions.controller.ts` (Story 1.4 — read fully first, it currently returns the bare session row). `GET /:id` now also returns `questions[]` (via `QuizQuestionResponseSchema`) once `status='ready'`, and `error_message` when `status='failed'`. Keep `@OwnsSession()` on this route unchanged.
  - [ ] `POST /api/sessions`'s response (once 2.4 has extended the request contract) includes the same `questions[]` + `actualCount` (when applicable) + `status` — this story owns building that response payload from the persisted rows, not the request-side validation (2.4's scope).
  - [ ] Add an ownership isolation test for the now-populated `GET /:id`: user A generates a quiz, user B requests it, gets 404 (extends Story 1.4's `ownership.security.test.ts` pattern to the populated response, not just the bare session).

- [ ] **Task 8 — Tests** (AC: #1, #2, #3, #4, #5, #6, #7, #8, #9, #10)
  - [ ] `apps/api/test/integration/generate-quiz-persist.test.ts` — happy path persists document/questions/answers correctly; `GET /:id` twice returns byte-identical quiz (no re-run); `is_correct` never appears in any response JSON (assert by key-absence, not by value).
  - [ ] `apps/api/test/integration/generate-quiz-shortfall.test.ts` — fixture pool with `V=6` at `questionCount=8` → `status='ready'`, `actualCount=6`, no padding; assert the response only includes `actualCount` when it's below the requested count.
  - [ ] `apps/api/test/integration/generate-quiz-failure.test.ts` — force `UntrustedLlmOutputError` from a mocked LLM adapter (via 2.3/2.4's port) after retry exhaustion; assert the response is `502`, **and** a fresh DB read after the request completes shows `status='failed'` with `error_message` set — proving the separate-transaction write survived the request-transaction rollback. This is the single highest-value test in this story.
  - [ ] `apps/api/test/security/rls-generation.security.test.ts` — direct `SELECT` on `documents`/`questions`/`answers` with `app.user_id` unset, run as the table-owner role, returns 0 rows on each (proves `FORCE` on all three); extends Story 1.4's `rls.security.test.ts` pattern.
  - [ ] `apps/api/test/security/ownership-generation.security.test.ts` — user A's generated quiz is invisible to user B via `GET /:id` (404).
  - [ ] Regression: assert `knowledge_categories` has 0 rows after generation completes (guards AD-16's single-writer rule — a future accidental insert here would defeat the NaN fix Story 3.1 depends on).
  - [ ] `apps/api/test/integration/generate-quiz-e2e.test.ts` — SM-1: runs the full `POST /api/sessions` pipeline against **pipecat** and **langchain** README fixtures (local fixture files standing in for the live SSRF-safe fetch, or the real fetch if network access is available in CI) and asserts `status='ready'` with a sensible quiz for both. This test can only be finished once Stories 2.1–2.5's real adapters exist — if they land after this story starts, wire against their real ports/adapters rather than re-mocking the whole pipeline.
  - [ ] Use-case coverage ≥ 80%, adapter coverage ≥ 60% (NFR-4 floors).
  - [ ] Run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify` before marking done.

## Dev Notes

### Scope boundary — read this first

This story is **persistence, failure state, and response shaping only**. It consumes 2.1–2.5's outputs; it does not re-implement any of their logic.

| Do NOT build here                                                                                                                                                                                                                             | Owned by                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| SSRF-safe fetch, GitHub blob→raw rewrite                                                                                                                                                                                                      | **Story 2.1**                                                                               |
| Neutralization, chunking, doc-size/content-density guard (`DOC_TOO_LARGE`/`DOC_TOO_SHORT`)                                                                                                                                                    | **Story 2.2**                                                                               |
| `MastraLlmAdapter`, provider capability matrix, `GET /api/config/providers`, OpenRouter free-model filtering                                                                                                                                  | **Story 2.3**                                                                               |
| The single structured LLM call, pool validation (grounding + secret-shaped-token checks), the shortfall **classification** and retry budget, `POST /sessions` request-contract Zod validation (`strategy`/`questionCount`/`provider`/`model`) | **Story 2.4**                                                                               |
| Category feasibility search, stratified draw, position assignment `0..Q-1`                                                                                                                                                                    | **Story 2.5**                                                                               |
| Landing page UI, provider/strategy pickers, progress affordance                                                                                                                                                                               | **Story 2.7**                                                                               |
| `knowledge_categories` row creation, `insights` row creation, `SubmitAnswersUseCase`                                                                                                                                                          | **Story 3.1 (Epic 3)**                                                                      |
| Quiz-taking UI, submit flow                                                                                                                                                                                                                   | **Epic 3**                                                                                  |
| `chat_messages` table, chat cache prefix                                                                                                                                                                                                      | **Story 4.1 (Epic 4)**                                                                      |
| Rate limiting, CORS, helmet, `SafeExceptionFilter`'s baseline shape, single-machine boot guard                                                                                                                                                | **Story 1.5** (this story only _extends_ the filter's error-code registry)                  |
| pino, `TracingPort`/`LangfuseAdapter`, Dockerfile, `fly.toml`                                                                                                                                                                                 | **Story 1.6** (this story only _consumes_ `TracingPort`)                                    |
| `user-id.middleware.ts`, the identity/ownership split itself, migrations `0000`/`0001`                                                                                                                                                        | **Stories 1.3/1.4** (this story _extends_ `identity.interceptor.ts` additively — see below) |

⚠️ **Do not re-validate the request body, re-run the LLM call, or re-implement the stratified draw here.** If you find yourself writing category-selection or grounding-check logic, you are duplicating 2.4/2.5's scope — stop and consume their output instead.

### Architecture compliance (binding)

- **AD-1/AD-2 — hexagonal.** The persist step and `enrich()` live in `domain/use-cases/` and must stay pure (no direct `drizzle-orm` imports) — all DB access goes through the repository ports implemented in `adapters/persistence/drizzle/`.
- **AD-3 — Zod DTOs at every boundary, "wire ≠ row".** This is the story's core new-schema work (Task 1, AC #12). The bug this prevents is concrete: if the controller returns `AnswerRowSchema`-shaped objects with `isCorrect: undefined` instead of a schema that never includes the field, a serialization change (or a future field rename) can leak it. Project it out at the schema level.
- **AD-9 — ownership + RLS, both split components.** The success-path writes ride the **existing** request transaction opened by `identity.interceptor.ts` (its GUC is already set from `POST /api/sessions`'s own identity resolution — no new interceptor work needed for the happy path). The **failure**-path write and **`enrich()`** are the two places in this story that must open **new**, independent transactions with their own `set_config` — this is the load-bearing distinction the whole story hinges on. Get it backwards (writing failure state in the still-open request transaction, or calling `enrich()` before commit) and both AC #3 and AC #6 silently fail: the failure row vanishes on rollback, and enrichment's writes are rejected by `FORCE ROW LEVEL SECURITY` because the new transaction's GUC copy attempt happens before the resource genuinely exists in a separate connection's view.
- **AD-16 — `knowledge_categories` has exactly one writer.** This story is explicitly named as one of the components that **must not** write it (generation persists only `questions`, `answers`, and the selected-category set on the session). A regression test enforces this (Task 8).
- **AD-N1/AD-N2 — closed-world, bounded critical path.** Nothing in this story calls Tavily or any additional LLM. The persist step is pure DB I/O; `enrich()`'s only external call is `tracingPort.flush()` (already-buffered data, no new LLM/network calls of its own beyond the flush itself).
- **Consistency Conventions — Zod field caps.** `question.text ≤ 500`, `explanation ≤ 2000` are enforced at the row-schema level (Task 1) even though the _values_ were already validated upstream by 2.4 — the row schema is this story's boundary and must not silently trust upstream validation forever.

### Post-commit execution — the gap this story must close

No source document (PRD, spine, architecture-spec, or the Epic 1 story files) specifies **how** `void enrich(sessionId, userId)` gets triggered only-after-commit. AD-N2 states the signature and the _reason_ (the GUC dies at commit, so enrichment must be a later, separate transaction) but not the trigger mechanism. Naively calling `enrich(...)` from inside `GenerateQuizUseCase.execute()` — which itself runs _inside_ the request transaction that `identity.interceptor.ts` opened — is unsafe on two counts: (1) it fires before that transaction has actually committed, so `enrich()`'s own transaction may not yet see the rows it might reference, and (2) more subtly, it defeats the entire "fresh transaction, fresh GUC" design if the outer transaction is still in flight when the inner one starts.

**Design ruling for this story:** extend `identity.interceptor.ts` (Story 1.4, read it fully before touching it) with a minimal post-commit hook — e.g. the `AsyncLocalStorage` context object gains an `onCommit(fn: () => void)` registration method, and the interceptor invokes every registered `fn` (fire-and-forget, errors caught and logged, never awaited, never surfaced to the response) immediately after its `db.transaction(...)` call resolves successfully. `GenerateQuizUseCase` calls `getRequestContext().onCommit(() => enrich(sessionId, userId))` instead of calling `enrich()` directly. This is additive to 1.4's interceptor — do not restructure its commit/rollback ownership, only add the hook list.

### Design ruling: what `enrich()` actually does in Epic 2

AD-N2 describes `enrich()`'s payload as "full doc + chunk persistence, chat cache prefix, `knowledge_categories` aggregate recomputation only, and Langfuse flush." Taken literally in this story's context, two of those four are either already handled elsewhere or impossible:

- **"Full doc + chunk persistence"** — this story's own AC #4/#7 (sourced directly from `epics.md`'s Story 2.6 text, and corroborated by `architecture-spec.md` §A.7 step 9, which places document+chunk persistence in the **synchronous** critical path) requires the `documents` row to exist by the time the response is returned. There is nothing left for `enrich()` to persist here — the document is already committed as part of the request transaction, before `enrich()` ever runs.
- **"`knowledge_categories` aggregate recomputation"** — the spine's own Deferred log (item N5) flags this as **currently dead code**: `knowledge_categories` rows don't exist until Story 3.1 creates them at submit time, and AD-16 forbids `enrich()` from ever `INSERT`ing them. There is nothing to recompute yet. Do not add an `INSERT` here to "make it do something" — that reintroduces the exact three-writer defect AD-16 exists to prevent.
- **What's left and genuinely in scope:** `tracingPort.flush()`, so the Langfuse trace(s) Story 2.4 emits for the generation LLM call aren't lost if Fly auto-stops the machine before a batched flush would otherwise fire. This is the concrete, buildable piece of `enrich()` for Epic 2.

Story 3.1 (Epic 3) is where the `knowledge_categories`-recompute clause either gets removed from AD-N2 or moved to a post-submit trigger — do not attempt to resolve that gap here.

### Data Model Contract

New tables (columns `snake_case` in Postgres, `camelCase` in Drizzle/Zod):

```
documents
  id                uuid PK default gen_random_uuid()
  session_id        uuid NOT NULL UNIQUE REFERENCES quiz_sessions(id)   -- 1:1 per ERD
  url               text NOT NULL
  content_markdown  text NOT NULL
  content_hash      text NOT NULL         -- SHA-256, from Story 2.1/2.2's output
  chunks            jsonb NOT NULL
  byte_size         integer NOT NULL
  token_estimate    integer NOT NULL
  ingested_at       timestamptz NOT NULL default now()

questions
  id            uuid PK default gen_random_uuid()
  session_id    uuid NOT NULL REFERENCES quiz_sessions(id)
  position      integer NOT NULL          -- 0-based, contiguous 0..Q-1 per session
  text          text NOT NULL             -- ≤500 chars
  type          text NOT NULL             -- 'single'|'multiple'
  category      text NOT NULL             -- from the selected-category set
  explanation   text NULL                 -- ≤2000 chars; stays NULL in v1 (no active FR populates it)

answers
  id            uuid PK default gen_random_uuid()
  question_id   uuid NOT NULL REFERENCES questions(id)
  position      integer NOT NULL          -- 0..3
  text          text NOT NULL
  is_correct    boolean NOT NULL          -- NEVER returned to the FE
```

`quiz_sessions` gains one column:

```
quiz_sessions
  ...(existing Story 1.3/1.4 columns)...
  selected_categories  jsonb NULL         -- string[]; the full C-category selection from Story 2.5,
                                           -- including any category that legitimately drew 0 questions
```

⚠️ **`completed_at` on `quiz_sessions` is out of scope for this story.** It is not set by generation — leave it untouched. (It most plausibly belongs to the submit flow in Story 3.1; do not guess and populate it here.)

### RLS migration contract — sequential numbering, do not renumber

Story 1.3 owns migration `0000` (`users` + `quiz_sessions`, no RLS). Story 1.4 owns migration `0001` (`current_session_user_id()` + RLS on `quiz_sessions` only — it deliberately does **not** touch `documents`/`questions`/`answers` because those tables didn't exist yet). This story is the **first** to create those three tables, so it is also the first that _can_ write their RLS policies — apply them in the same migration that creates the tables, not as a follow-up. No other Epic 2 story touches Drizzle migrations (2.1–2.5 are all in-memory/adapter work with no schema changes), so there should be no numbering collision — but verify against whatever actually exists in `apps/api/drizzle/` at dev time before generating, since sibling stories are being authored concurrently.

### Previous story intelligence (Epic 1, all read in full for this story)

- **Story 1.3** created `users`+`quiz_sessions` (migration `0000`), the Drizzle `pg.Pool` client with `statement_timeout`/`query_timeout`, and the `/healthz` vs `/api/health` split. This story's new tables reuse that same client/pool — do not create a second connection config.
- **Story 1.4** established: the `set_config('app.user_id', $1, true)` fix (SET LOCAL cannot bind parameters — this story's failure-write and `enrich()` transactions must use the same pattern, not the literal-interpolated `SET LOCAL` form from the older architecture docs); `identity.interceptor.ts` owns the request transaction and its commit/rollback; `NotFoundError → 404`, never 403; the depth-1/depth-2 RLS policy template this story executes for real; and the ESLint rule `@ai-quiz/no-unscoped-session-query`, which this story's new repository methods must satisfy.
- **Story 1.5** builds `SafeExceptionFilter` with a domain-error-to-HTTP mapping this story extends (Task 5) — read the actual implementation before assuming its shape; the story file only specifies `HttpException → its own status` and `everything else → 500`, so the mechanism for mapping a bespoke domain error like `NotFoundError`/`UntrustedLlmOutputError` to a specific non-500 status must already exist there (1.4's 404 depends on it) — follow that existing mechanism, don't invent a second one.
- **Story 1.6** builds `TracingPort` (interface, pure) + `LangfuseAdapter` + a no-op fallback when Langfuse env vars are absent. This story's `enrich()` is the first real consumer of `TracingPort.flush()` outside 1.6's own synthetic-trace test — inject it the same way 1.6's `ObservabilityModule` registers it (`TRACING_PORT` token).

No Epic 2 sibling story files (2.1–2.5, 2.7) exist yet in `_bmad-output/implementation-artifacts/` at the time this story was authored — they are being written concurrently. Their scopes are taken from `epics.md` directly (cited below); if their eventual story files diverge from `epics.md`'s text, prefer what actually got built and flag the divergence rather than silently reconciling it.

### Project Structure Notes

```
apps/api/src/
  domain/
    use-cases/GenerateQuizUseCase.ts        UPDATE (2.4/2.5 build earlier segments; this story appends persist+return+enrich-trigger)
    ports/DocumentRepositoryPort.ts         NEW
    ports/QuizRepositoryPort.ts             UPDATE (2.4-owned file if it created it first; else NEW — add persist/failure-write methods)
  adapters/
    persistence/drizzle/
      schema.ts                             UPDATE (append documents/questions/answers + quiz_sessions.selected_categories)
      document.repository.ts                NEW
      question.repository.ts                NEW
      answer.repository.ts                  NEW
  driving/
    sessions/sessions.controller.ts         UPDATE (Story 1.4 — GET /:id + POST /sessions response now include questions[])
    middleware/identity.interceptor.ts      UPDATE (Story 1.4 — additive onCommit hook only)
    middleware/safe-exception.filter.ts     UPDATE (Story 1.5 — add UntrustedLlmOutputError → 502)
apps/api/drizzle/                           NEW migration (documents/questions/answers + RLS + quiz_sessions.selected_categories)
apps/api/test/integration/
  generate-quiz-persist.test.ts             NEW
  generate-quiz-shortfall.test.ts           NEW
  generate-quiz-failure.test.ts             NEW
  generate-quiz-e2e.test.ts                 NEW (SM-1)
apps/api/test/security/
  rls-generation.security.test.ts           NEW
  ownership-generation.security.test.ts     NEW
packages/shared/src/schemas.ts              UPDATE (DocumentRowSchema, QuestionRowSchema, AnswerRowSchema, QuizQuestionResponseSchema, QuizSessionRowSchema.selectedCategories)
```

Naming follows the spine's Consistency Conventions: kebab-case files, PascalCase classes, camelCase vars, `*.port.ts`/`*.adapter.ts`/`*.dto.ts` suffixes.

### Testing Requirements

- **Framework:** Vitest. Integration tests in `apps/api/test/integration/`, security tests in `apps/api/test/security/` (never colocated in `src/`).
- **Coverage floors (NFR-4/AD-N10):** use-cases ≥ 80%, adapters ≥ 60%.
- **Real Postgres required** for the RLS and migration tests — do not mock the DB for anything asserting `FORCE ROW LEVEL SECURITY` behavior; run those as the table-owner role, same pattern as Story 1.4's `rls.security.test.ts`.
- **The failure-transaction-survives-rollback test is the highest-value test in this story** (Task 8) — it is the only test that actually proves AC #3, and it is the single easiest thing to get subtly wrong (see Post-commit section above).
- No Playwright work here — no new UI surface (Story 2.7 owns the landing page).
- Before completing: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify`.

### Anti-pattern watchlist

- ❌ Writing `status='failed'` inside the same transaction the interceptor will roll back → the row vanishes, the UI shows nothing, the session is stuck invisible forever.
- ❌ Calling `enrich(sessionId, userId)` synchronously inside `execute()` before the request transaction commits → its own `set_config` runs against a transaction that either can't see committed data yet or (worse) shares state with the still-open request transaction in ways the design never intended.
- ❌ Inserting `knowledge_categories` rows "since we're touching aggregates anyway" in `enrich()` → directly violates AD-16's single-writer rule and reopens the NaN-avgRawScore defect Story 3.1 exists to close.
- ❌ Reusing `QuestionRowSchema`/`AnswerRowSchema` (which carry `is_correct`) as the HTTP response shape → the exact AD-3 failure mode this story's schema split (Task 1) exists to prevent.
- ❌ Regenerating or renumbering migrations `0000`/`0001` → destroys Stories 1.3/1.4's committed migration history.
- ❌ Re-deriving the shortfall ladder, grounding check, or stratified draw here "to be safe" → duplicates 2.4/2.5, and any divergence between the two copies is a correctness bug waiting to happen.
- ❌ Adding a `cost_spent` column or per-session budget anywhere near this migration → removed 2026-07-19, do not resurrect it.
- ❌ Populating `questions.explanation` with an LLM call → no active FR requires it in v1; wiring one here is unscoped work.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.6-Persist-the-quiz-failure-state--enrichment] — the ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-2-Generate-a-grounded-quiz-from-any-URL] — epic boundary note, sibling stories 2.1–2.5/2.7 scopes
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.4] — shortfall ladder single-authority note, "full end-to-end path asserted once, in Story 2.6"
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.5] — stratified draw + position assignment output this story consumes
- [Source: .../ARCHITECTURE-SPINE.md#AD-9] — identity/ownership split; `set_config` requirement; non-request paths must set the GUC themselves
- [Source: .../ARCHITECTURE-SPINE.md#AD-N2] — `void enrich(sessionId, userId)` signature and payload description
- [Source: .../ARCHITECTURE-SPINE.md#AD-N4] — shortfall ladder (steps 1–3), `V < 5` is the only path to `failed`
- [Source: .../ARCHITECTURE-SPINE.md#AD-16] — `knowledge_categories` single-writer rule
- [Source: .../ARCHITECTURE-SPINE.md#AD-3] — "one schema per boundary, not per entity" clarification
- [Source: .../ARCHITECTURE-SPINE.md#Deferred] — item N5 (`enrich()`'s recompute clause is dead code until 3.1), item N9 (`selected_categories` column gap), item N6 (wire-projection ownership gap)
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.5-Data-Model] — `documents`/`questions`/`answers` columns; RLS section
- [Source: .../architecture-spec.md#A.7-Agent-Flows] — sync critical-path steps 9–10 (persist + return)
- [Source: .../architecture-spec.md#A.13-Build-Order] — step 4 (Drizzle schema + migrations incl. RLS)
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#OQ-3] — actualCount / no-padding resolution
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#Success-Metrics] — SM-1
- [Source: _bmad-output/implementation-artifacts/1-3-api-skeleton-db-foundation-and-health-endpoints.md] — migration `0000`, `pg.Pool` client, `final_score` numeric-as-string gotcha
- [Source: _bmad-output/implementation-artifacts/1-4-per-session-ownership-walking-skeleton-sessions-endpoint.md] — migration `0001`, `set_config` fix, identity/ownership split, RLS policy template, `@ai-quiz/no-unscoped-session-query`
- [Source: _bmad-output/implementation-artifacts/1-5-network-hardening-rate-limiting-cors-helmet-error-shape.md] — `SafeExceptionFilter` shape and status-preservation contract
- [Source: _bmad-output/implementation-artifacts/1-6-observability-and-deploy-the-skeleton.md] — `TracingPort`/`LangfuseAdapter`, "must await flush()" note, no-op fallback
- [Source: _bmad-output/project-context.md#Quiz-generation-flow] — enrichment-is-optimization-never-correctness invariant
- [Source: AGENTS.md#Stop-and-ask-before] — data-model changes (this story adds tables + a column — within its own granted scope, but flagged per the constitution's spirit)

### Open questions / spec gaps (non-blocking — flagged for the human)

1. **`enrich()`'s post-commit trigger mechanism is this story's own design, not a source-cited pattern.** No planning artifact specifies _how_ `void enrich(...)` gets invoked only-after-commit; this story proposes an additive `onCommit` hook on `identity.interceptor.ts`'s AsyncLocalStorage context. If a different mechanism is preferred (e.g. a NestJS lifecycle event, a message-queue-free `setImmediate` keyed off the HTTP response's `finish` event), reconcile before Story 4.1 builds its own enrichment-adjacent work on top of whatever pattern lands here.
2. **`UntrustedLlmOutputError → 502` is a ruling, not a citation.** No source document assigns this error an HTTP status. 502 (Bad Gateway — upstream/provider exhausted its retry budget) was chosen over 500 (implies a bug, not an expected failure mode) and over 400 (implies the client's input was wrong, which it wasn't). Confirm this matches whatever convention Story 1.5's actual `SafeExceptionFilter` implementation establishes for other domain errors.
3. **`selected_categories` persistence (this story's Task 1/2/AC #10) resolves spine Deferred item N9**, which nominally names Story 2.4 as the place to "add the column in the Story 2.4 migration." Since 2.4's own AC text explicitly ends before any persistence happens ("ending when a validated pool exists in memory"), this story is the first and only one that owns a migration in Epic 2 — the column is added here instead. Flagging in case 2.4 independently decided to touch schema/migrations before this story lands, which would collide.
4. **SM-1's fixture mechanism (pipecat/langchain READMEs) is unspecified for tests.** Given SSRF-safe-fetch (Story 2.1) restricts live network fetches at runtime, the SM-1 integration test in this story either (a) fetches the real READMEs over the network if CI permits egress, or (b) uses committed local fixture copies of both READMEs and stubs the ingestion port at the boundary. Neither is mandated by any source document; pick (b) unless Story 2.1's own tests already established (a) as the project's pattern — check before duplicating a different fixture strategy.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
