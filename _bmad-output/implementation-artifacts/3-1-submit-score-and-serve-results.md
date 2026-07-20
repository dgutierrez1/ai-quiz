# Story 3.1: Submit, score & serve results

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want my complete submission scored once and returned with my category breakdown and study insights,
so that I immediately see how I did and what to study next.

## Acceptance Criteria

_(FR-7, FR-17, FR-6 consumed, AD-15, AD-16, AD-N5)_

1. **Complete submissions only.** Given `POST /api/sessions/:id/submit`, when the payload does not carry exactly one response per session question with an ID set matching the session's exactly, then it returns **400** (missing or extra IDs) — `IncompleteSubmissionError`.
2. **Empty selection rejected.** Given a response whose `selected` array is empty, then `POST /submit` returns **400** — enforced at the Zod request boundary (`selected.min(1)`), not by a domain error. The server is authoritative; FR-5's client-side gate is convenience only. `scoreQuestion`'s empty→0 branch (packages/shared, Story 1.2) stays as pure-function robustness and remains unreachable through this API.
3. **Position resolved server-side.** Given a submit, the server resolves each response's `position` from `questions.position` by `question_id`, never from the request array index.
4. **Scoring via `packages/shared`.** Raw and weighted scores use the Story 1.2 scoring module (`scoreQuestion`, `weightedFinalScore`, `geometricWeights`) unmodified; `finalScore = weightedFinalScore(...)` over contiguous positions `0..n-1`.
5. **Idempotency.** `user_responses` has `UNIQUE(session_id, question_id)`; the state transition is atomic (`UPDATE quiz_sessions SET status='submitted', final_score=$1, completed_at=now() WHERE id=$2 AND status='ready' RETURNING ...`). A duplicate or concurrent submit returns the same cached result and never 5xxs.
6. **Non-`ready` submit → 409.** Given a submit against a session whose status is `pending` or `failed`, it returns **409 Conflict** with the current status in the body — distinct from the **200** cached-result path for an already-`submitted` session.
7. **Single response shape, `strengthByCategory` bug fixed.** A successful submit returns one response: `{sessionId, finalScore, actualCount?, breakdown[] (questionId, position, rawScore, weight, weightedScore, correctAnswers), categoryBreakdown[], insights {topicsToStudy[], weakCategories[], strengthByCategory}}`, computed synchronously. **`strengthByCategory` is a `Record<categoryName, 'strong'|'mixed'|'weak'>`**, not the single scalar the PRD's TypeScript sketch showed — Story 1.2 flagged this as a probable shape bug (its comment says "per-category" while the type read as a scalar); this story is the owner of `SubmitResponse` and resolves it as a map, pinned in `packages/shared/src/schemas.ts`.
8. **`knowledge_categories` — sole creator, zero-count exclusion.** `SubmitAnswersUseCase` is the **sole** creator of `knowledge_categories` rows (generation, Story 2.6, never inserts them; async enrichment never inserts them — AD-16). A row is materialized only for categories that received ≥ 1 drawn question (eliminates the `0/0 = NaN` `avgRawScore` path). `correct_count` (iff `rawScore === 4`, per Story 1.2's resolved semantics), `avg_raw_score`, `weighted_score`, and `strength` are populated for each materialized row. Categories compare by `avgRawScore`.
9. **`GET /sessions/:id` branches by status.** A **submitted** session returns results + insights (extends the existing route). A **ready** session continues to return questions without `is_correct`, unchanged from Story 2.6. (`pending`/`failed` behavior is also unchanged.)
10. **Ownership.** Submit and (the submitted-branch of) the result route use `@OwnsSession()`; cross-user access returns **404** (isolation test).
11. **RLS on all three new tables.** `user_responses`, `insights`, and `knowledge_categories` each get `ENABLE` + `FORCE ROW LEVEL SECURITY` and a depth-1 (`session_id`-joined) policy, following Story 1.4's template.

### Additional acceptance criteria (derived from binding ADs / spec gaps this story must resolve — treat as equally required)

12. **New migration, sequential.** A single new migration (sequential after Story 2.6's `documents`/`questions`/`answers` migration — do **not** renumber or regenerate `0000`–`0002`) creates `user_responses`, `insights`, `knowledge_categories` and their RLS policies.
13. **`numeric` columns readable as numbers.** `apps/api/src/adapters/persistence/drizzle/client.ts` (Story 1.3's file) configures a `pg` type parser for OID `1700` (`numeric`) so `final_score`, `raw_score`, `weight`, `weighted_score`, `avg_raw_score` round-trip as JS `number`, not `string` — resolving the gap Story 1.3 explicitly deferred to whichever story first writes a `numeric` column ("not load-bearing until Story 3.1 writes the column... decide here").
14. **`topicsToStudy`/`docSnippets` resolved without an LLM call.** Insights are computed **synchronously and purely** (AD-15: "computed at submit time, synchronously, by `CategoryAggregatorService` + `rankWeakCategories`") — no LLM call, no Tavily call, inside `POST /submit`. `architecture-spec.md` §A.7's "Gap analysis" flow narrates an LLM step producing narrative text; that is **stale, pre-audit residue superseded by the spine's binding AD-15 rule** and is **not implemented**. `docSnippets` are selected deterministically from already-persisted `documents.chunks` (`string[]`, Story 2.2/2.6) by token-overlap against the weak category's question text — see Dev Notes → "Resolving the `insights` writer + `topicsToStudy` shape (spine Deferred item N8)".
15. **Error registry extended, not forked.** `IncompleteSubmissionError → 400` (`INCOMPLETE_SUBMISSION`) and `SessionNotReadyError → 409` (`SESSION_NOT_READY`, body carries `status`) are added to Story 1.5's `SafeExceptionFilter` domain-error registry — the same registry Story 2.6 extended for `UntrustedLlmOutputError → 502`. Read that file fully before editing; do not create a second error-mapping mechanism.
16. **AD-N2's enrichment recompute clause is declared moot for v1.** The spine's Deferred item N5 asks this story to either drop AD-N2's "`knowledge_categories` aggregate recomputation" clause or move it to a post-submit trigger. Ruling: since this story computes and persists `knowledge_categories` **completely and synchronously** at submit time, and v1 has no post-submit async step that touches these rows again, the clause is dead going forward. This story does **not** touch `identity.interceptor.ts`'s `onCommit` hook (Story 2.6) or call `enrich()` — submit has no async follow-up work in v1. Flagged for a future spine edit; out of scope to edit `ARCHITECTURE-SPINE.md` here.

## Tasks / Subtasks

- [ ] **Task 1 — Shared Zod schemas** (AC: #7, #8, #12, #13, #14)
  - [ ] In `packages/shared/src/schemas.ts` (UPDATE — read the whole file first; Stories 1.2/1.3/1.4/2.6 already populated it), add:
    - `SubmitAnswerSchema`: `{ questionId: z.string().uuid(), selected: PositionSetSchema }` where the array is additionally constrained to **non-empty** (chain an extra `.refine((arr) => arr.length >= 1, ...)` on top of Story 1.2's `PositionSetSchema` uniqueness refine — do not weaken `PositionSetSchema` itself, which must stay usable for the empty-array pure-function tests in `scoring.test.ts`).
    - `SubmitRequestSchema`: `{ responses: z.array(SubmitAnswerSchema) }.strict()`. Zod cannot validate "matches this session's dynamic question-ID set" — that stays a use-case-level check (Task 5).
    - `UserResponseRowSchema`: `{ id, sessionId, questionId, selected: PositionSetSchema, rawScore: z.number(), weight: z.number(), weightedScore: z.number(), submittedAt: z.date() }` — the full DB-row shape; distinct from Story 1.2's narrower `UserResponseSchema` (which lacks `id`/`sessionId`/`submittedAt` and exists for the scoring module's own signature). Do not conflate the two (AD-3 "row ≠ request ≠ wire").
    - `QuestionResultSchema` (wire, the `breakdown[]` element per FR-7's literal shape): `{ questionId: z.string().uuid(), position: z.number().int(), rawScore: z.number(), weight: z.number(), weightedScore: z.number(), correctAnswers: PositionSetSchema }`. `correctAnswers` sorted ascending for determinism.
    - `TopicToStudySchema`: `{ topic: z.string(), reason: z.string(), docSnippets: z.array(z.string()) }`.
    - `InsightsSchema`: `{ topicsToStudy: z.array(TopicToStudySchema), weakCategories: z.array(z.string()), strengthByCategory: z.record(z.string(), z.enum(['strong','mixed','weak'])) }` — **the AC #7 bug fix lives here**: a `record`, never a bare `z.enum(...)` scalar.
    - `InsightsRowSchema`: `{ id: z.string().uuid(), sessionId: z.string().uuid(), kind: z.literal('gap_analysis'), payload: InsightsSchema, sources: z.array(z.string()).nullable(), createdAt: z.date() }`.
    - `KnowledgeCategoryRowSchema`: Story 1.2's `CategoryPerformanceSchema` extended via `.extend({ id: z.string().uuid(), sessionId: z.string().uuid() })` — do **not** redefine `name`/`questionCount`/`correctCount`/`avgRawScore`/`weightedScore`/`strength`; those already exist from Story 1.2.
    - `SubmitResponseSchema`: `{ sessionId: z.string().uuid(), finalScore: z.number(), actualCount: z.number().int().optional(), breakdown: z.array(QuestionResultSchema), categoryBreakdown: z.array(CategoryPerformanceSchema), insights: InsightsSchema }`.
    - `RevealedQuestionResponseSchema`: same shape as Story 2.6's `QuizQuestionResponseSchema` but `answers[]` includes `isCorrect: boolean` — a **distinct** wire schema (AD-3 "wire ≠ row"), used only once `status='submitted'`. Do not add `isCorrect` to `QuizQuestionResponseSchema` itself (that would leak answers pre-submit).
  - [ ] Add a Vitest assertion (alongside the existing Drizzle↔Zod drift guards from Stories 1.3/2.6) that the three new Drizzle tables' column key sets equal their Row schema key sets.

- [ ] **Task 2 — Drizzle schema + migration** (AC: #11, #12)
  - [ ] Add `user_responses`, `insights`, `knowledge_categories` table definitions to `apps/api/src/adapters/persistence/drizzle/schema.ts` (UPDATE — Story 2.6's file; append, do not restructure). Column shapes: see Dev Notes → Data Model Contract.
  - [ ] Generate one new migration (`pnpm db:generate`) — verify it lands as the next sequential number after Story 2.6's migration (do **not** touch `0000`–`0002`).
  - [ ] Append RLS DDL to that migration: `ENABLE` + `FORCE ROW LEVEL SECURITY` on all three tables, plus (all depth-1, `session_id`-joined — none of these tables need the `answers`-style depth-2 join):
    ```sql
    CREATE POLICY user_user_responses ON user_responses
      USING (EXISTS (SELECT 1 FROM quiz_sessions s
                     WHERE s.id = user_responses.session_id
                       AND s.user_id = current_session_user_id()));

    CREATE POLICY user_insights ON insights
      USING (EXISTS (SELECT 1 FROM quiz_sessions s
                     WHERE s.id = insights.session_id
                       AND s.user_id = current_session_user_id()));

    CREATE POLICY user_knowledge_categories ON knowledge_categories
      USING (EXISTS (SELECT 1 FROM quiz_sessions s
                     WHERE s.id = knowledge_categories.session_id
                       AND s.user_id = current_session_user_id()));
    ```
  - [ ] `current_session_user_id()` already exists from Story 1.4's migration — reuse it, do not redefine.
  - [ ] `user_responses` gets a `UNIQUE (session_id, question_id)` constraint; `knowledge_categories` gets `UNIQUE (session_id, name)`.
  - [ ] Verify the migration applies cleanly via `node dist/main.js migrate` against a fresh docker-compose Postgres with `0000`–`0002` already applied.

- [ ] **Task 3 — `client.ts` numeric type parser** (AC: #13)
  - [ ] In `apps/api/src/adapters/persistence/drizzle/client.ts` (UPDATE — Story 1.3), before the pool is constructed, register `import { types } from 'pg'; types.setTypeParser(1700, (val) => parseFloat(val));` (OID 1700 = `numeric`/`decimal`). This is a process-wide `pg` setting — apply it once at module load.
  - [ ] Update every Zod row schema with a `numeric` counterpart (`QuizSessionRowSchema.finalScore`, `UserResponseRowSchema.rawScore/weight/weightedScore`, `KnowledgeCategoryRowSchema.avgRawScore/weightedScore`) to plain `z.number()` (nullable where the column is nullable) — **not** `z.coerce.number()` and not a string-typed field. The parser is what makes this legal; without it these schemas would throw on every read.
  - [ ] Add a regression test asserting a round-tripped `numeric` column comes back as `typeof value === 'number'` from a real query (not string-typed).

- [ ] **Task 4 — Ports + repositories (canonical adapter pattern)** (AC: #3, #4, #5, #6, #8, #9, #10)
  - [ ] New `apps/api/src/domain/ports/submission-repository.port.ts` (`SubmissionRepositoryPort`) — a dedicated port rather than further overloading `QuizRepositoryPort`, given the growing surface area (3 new tables):
    - `findQuestionsWithAnswersForUser(sessionId, userId): Promise<QuestionWithAnswersDto[] | null>` — internal read, **includes** `isCorrect` (needed to score); null on not-found/not-owned. Distinct from Story 2.6's outbound `QuizQuestionResponseSchema`-shaped read, which hides it.
    - `findDocumentChunksForUser(sessionId, userId): Promise<readonly string[]>` — reads `documents.chunks`.
    - `trySubmit(input): Promise<{ won: boolean }>` — the **sole write path**. Attempts the atomic `UPDATE ... WHERE status='ready' RETURNING`. If it affects 1 row, this call is the race winner: within the **same** (already-open, ALS-bound) request transaction it also inserts the `user_responses` rows, the `knowledge_categories` rows, and the `insights` row, then returns `{won: true}`. If it affects 0 rows, it does **not** write anything else and returns `{won: false}` — the caller (the use-case) falls back to the read path.
    - `getSubmittedResult(sessionId, userId): Promise<SubmitResultDto | null>` — pure read: joins `quiz_sessions.final_score` + `user_responses` + `questions` + `answers` (for `breakdown[]`/`correctAnswers`) + `knowledge_categories` (for `categoryBreakdown`) + `insights.payload` (for `insights`, read verbatim, never recomputed). Returns null if the session isn't `submitted` or doesn't exist/isn't owned.
  - [ ] Every method that returns rows ends `Object.freeze(Schema.parse(...))` (AD-3). Every session-scoped query is named `forUser*`/uses this port's already-scoped methods so `@ai-quiz/no-unscoped-session-query` (Story 1.4) passes.
  - [ ] All methods bind to the ALS `tx` from `identity.interceptor.ts` (Story 1.4) — never a fresh pool connection.
  - [ ] ⚠️ **Why the atomic UPDATE gates *before* any child-table insert (not after):** because the `UPDATE ... WHERE status='ready'` targets a specific `quiz_sessions` row, Postgres row-level locking serializes concurrent attempts against the *same* session — a second concurrent `UPDATE` blocks until the first commits, then re-evaluates `WHERE status='ready'`, which is now false, and affects 0 rows. Gating the child-table inserts behind this single atomic statement means **only the winner ever attempts an insert**, so the `UNIQUE(session_id, question_id)`/`UNIQUE(session_id, name)` constraints are never actually raced — there is no unique-violation-catch path to write. Reversing the order (insert first, update second) reopens exactly that race.

- [ ] **Task 5 — Pure domain services: category aggregation + insight-snippet matching** (AC: #7, #8, #14)
  - [ ] `apps/api/src/domain/quiz/services/category-aggregator.service.ts` — a **plain exported-function module**, not a NestJS-injectable class, consistent with the domain-purity pattern Story 2.2's `chunker.ts` and Story 2.4's grounding-check services already established (AD-1/AD-2 forbid NestJS decorators under `domain/`). Exports `buildInsights(categoryBreakdown: readonly CategoryPerformanceDto[], docSnippetsByCategory: ReadonlyMap<string, string[]>): InsightsDto`:
    - `weakCategories` = names of categories with `strength === 'weak'`, in the order `rankWeakCategories` (Story 1.2) already produces (ascending `avgRawScore`, tie-break ascending `name`) — filtered, not re-sorted.
    - `topicsToStudy` covers **exactly** the weak categories (same set as `weakCategories` — a deliberate scope decision: no source document specifies whether `mixed` categories also get a `topicsToStudy` entry, and keeping the two fields' category sets identical avoids inventing an unspecified inclusion rule). Each entry: `topic = category.name`; `reason` is a deterministic template, e.g. `` `Scored ${avgRawScore.toFixed(1)}/4 across ${questionCount} question${questionCount === 1 ? '' : 's'} in this category.` ``; `docSnippets` comes from the `docSnippetsByCategory` map (built via `selectDocSnippets`, next bullet).
    - `strengthByCategory` = `Object.fromEntries(categoryBreakdown.map(c => [c.name, c.strength]))`.
  - [ ] `apps/api/src/domain/quiz/services/topic-snippet-matcher.ts` — new pure function `selectDocSnippets(categoryQuestionText: string, chunks: readonly string[], limit = 2, snippetMaxChars = 300): string[]`. Deterministic token-overlap ranking (lowercase, strip punctuation, split on whitespace, drop a small hardcoded stopword list, Jaccard-style overlap between the category's concatenated question+answer text and each chunk), returns the top `limit` chunks truncated to `snippetMaxChars`, **never empty when `chunks` is non-empty** (fall back to the first chunk in document order if nothing scores above a minimal threshold, so the UI never shows a blank snippet list for a genuinely weak category). This is a **new, separately-authored** function — it is conceptually similar to Story 2.4's `grounding-check.ts` `isGrounded` (also token-overlap-based) but is not a modification of that file (2.4 is a concurrently-authored sibling story; do not edit it). Some small duplication of the token-overlap heuristic is an acceptable trade-off versus cross-story file coupling.
  - [ ] Both are pure (no I/O); domain unit tests run in <100ms (AD-2).

- [ ] **Task 6 — Domain errors** (AC: #1, #6, #15)
  - [ ] `apps/api/src/domain/quiz/errors/incomplete-submission.error.ts` — `IncompleteSubmissionError` (extends the same base domain error class earlier stories use, if one exists).
  - [ ] `apps/api/src/domain/quiz/errors/session-not-ready.error.ts` — `SessionNotReadyError(status: 'pending' | 'failed')`, carrying `status` as a property the filter surfaces in the response body (same "tolerate an extra field" pattern Story 1.5 already established for `DOC_TOO_LARGE`'s `hint`).

- [ ] **Task 7 — `SubmitAnswersUseCase`** (AC: #1–#8)
  - [ ] `apps/api/src/domain/use-cases/SubmitAnswersUseCase.ts` — **NEW** (first story to create this file, per the spine's source tree). `execute(sessionId, userId, request: SubmitRequestDto): Promise<SubmitResponseDto>`:
    1. `session = await quizRepo.findByIdAndUserId(sessionId, userId)` (existing Story 1.4/2.6 method) — null → `NotFoundError` (404).
    2. `session.status === 'submitted'` → `result = await submissionRepo.getSubmittedResult(sessionId, userId)`; return it (200). No request-body validation runs on this branch — the cached result is authoritative regardless of what the retried payload contains.
    3. `session.status === 'pending' | 'failed'` → throw `SessionNotReadyError(session.status)` (409).
    4. `session.status === 'ready'`:
       - `questionsWithAnswers = await submissionRepo.findQuestionsWithAnswersForUser(sessionId, userId)`.
       - Validate the response ID set exactly matches the session's question ID set → `IncompleteSubmissionError` (400) on any mismatch (missing or extra).
       - For each response: resolve `position` from the matching question (never the request array index — AC #3); `scoreQuestion(type, correctPositions, selected)` (Story 1.2).
       - `n = questionsWithAnswers.length`; `weights = geometricWeights(n)`; per-response `weight = weights[position]`, `weightedScore = rawScore * weight`.
       - `finalScore = weightedFinalScore(perQuestion)` (Story 1.2).
       - `categoryBreakdown = aggregateByCategory(questionsWithAnswers, scoredResponses)` (Story 1.2 — already excludes zero-question categories by construction).
       - `documentChunks = await submissionRepo.findDocumentChunksForUser(sessionId, userId)`.
       - For each weak category, `selectDocSnippets(...)` (Task 5) over that category's question+answer text against `documentChunks`.
       - `insights = buildInsights(categoryBreakdown, docSnippetsByCategory)` (Task 5).
       - `actualCount = n < session.questionCount ? n : undefined`.
       - `{won} = await submissionRepo.trySubmit({sessionId, userId, responses: scoredResponses, finalScore, categoryBreakdown, insights, actualCount})`.
       - `won === true` → shape and return the response **directly from in-memory data** (no re-read — the use-case already computed everything); status **200**.
       - `won === false` (lost the race to a concurrent submit) → `result = await submissionRepo.getSubmittedResult(sessionId, userId)`; return it (200).
  - [ ] All I/O goes through the two injected ports (`QuizRepositoryPort`, `SubmissionRepositoryPort`) — no direct `drizzle-orm` import (AD-1/AD-2).

- [ ] **Task 8 — Controller wiring** (AC: #9, #10)
  - [ ] `apps/api/src/driving/sessions/sessions.controller.ts` (UPDATE — Story 1.4/2.6's file; read fully first):
    - `POST ':id/submit'` — `@OwnsSession()`, `ZodValidationPipe(SubmitRequestSchema)`, calls `SubmitAnswersUseCase.execute`, returns `SubmitResponseSchema`-shaped body with **200**.
    - `GET ':id'` — extend the existing branch logic: when `session.status === 'submitted'`, additionally call `submissionRepo.getSubmittedResult(...)` and a repository method returning `RevealedQuestionResponseSchema[]` (questions + answers, `isCorrect` revealed — safe now that the session is submitted), merge, and return `{...session fields, questions, finalScore, breakdown, categoryBreakdown, insights, actualCount?}`. The existing `ready`/`pending`/`failed` branches (Story 2.6) are **unchanged**.
  - [ ] No new rate-limit tier: `POST /api/sessions/:id/submit` is not one of AD-N7's named routes (Global / `POST /sessions` / `POST /chat`), so it inherits the **Global 30/min** (per-user + per-IP) limit from Story 1.5 — do not add a bespoke `@Throttle...` decorator for it.
  - [ ] Add the ownership isolation test: user A submits, user B `GET`s or attempts `POST .../submit` on A's session, receives 404.

- [ ] **Task 9 — `SafeExceptionFilter` registry extension** (AC: #15)
  - [ ] Read `apps/api/src/driving/middleware/safe-exception.filter.ts` (Story 1.5, extended once already by Story 2.6) fully. Add `IncompleteSubmissionError → 400 / INCOMPLETE_SUBMISSION` and `SessionNotReadyError → 409 / SESSION_NOT_READY` (body includes `status` from the error) to its existing registry — do not fork a second mapping mechanism.

- [ ] **Task 10 — Tests** (AC: all)
  - [ ] `apps/api/test/domain/category-aggregator.test.ts`, `topic-snippet-matcher.test.ts` — pure unit tests: `weakCategories`/`topicsToStudy` scope match; `strengthByCategory` is a map keyed by every category, not a scalar; `selectDocSnippets` determinism, non-empty-when-chunks-non-empty, truncation.
  - [ ] `apps/api/test/use-cases/submit-answers-use-case.test.ts` — mocked ports: happy path scores correctly and matches `packages/shared`'s own test fixtures; missing/extra question ID → `IncompleteSubmissionError`; `pending`/`failed` session → `SessionNotReadyError`; already-`submitted` session skips validation entirely and returns the cached result; `won:false` branch returns the same shape as `won:true`.
  - [ ] `apps/api/test/integration/submit.integration.test.ts` — real Postgres: full submit persists `user_responses`/`knowledge_categories`/`insights`; a **second identical POST** (idempotent retry) returns byte-identical `finalScore`/`breakdown`/`categoryBreakdown`/`insights` and does **not** insert a second `knowledge_categories` row per category (UNIQUE constraint never violated because `trySubmit` gates on the atomic UPDATE); **concurrent submits** (two simultaneous requests against the same `ready` session) — one wins, one gets the cached result, neither 5xxs; submit against `pending` → 409 `{status:'pending'}`; submit against `failed` → 409; empty `selected: []` → 400 via Zod; `GET /:id` on a submitted session returns results + insights matching the original submit response; `GET /:id` on a ready session is unchanged (regression against Story 2.6's test).
  - [ ] `apps/api/test/security/rls-submission.security.test.ts` — direct `SELECT` on `user_responses`/`insights`/`knowledge_categories` with `app.user_id` unset, run as table-owner, returns 0 rows on each (proves `FORCE`).
  - [ ] `apps/api/test/security/ownership-submission.security.test.ts` — user A submits; user B's `POST .../submit` and `GET /:id` both 404.
  - [ ] Regression: assert `knowledge_categories` has exactly the materialized-category rows (no zero-count categories) after submit, and that generation (Story 2.6's own tests) still shows 0 rows before submit runs (guards AD-16's single-writer invariant across epics).
  - [ ] `apps/api/test/adapters/client-numeric-parser.test.ts` — a real query against a `numeric` column returns a JS `number`.
  - [ ] Use-case coverage ≥ 80%, adapter coverage ≥ 60% (NFR-4 floors).
  - [ ] Run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify` before marking done.

## Dev Notes

### Scope boundary — read this first

This story is **scoring orchestration, persistence, and the submit/result response contract only**. It consumes the Epic 1 scoring module and the Epic 2 quiz data; it does not touch generation.

| Do NOT build here | Owned by |
|---|---|
| Quiz-taking UI, answer selection, prev/next, client-side submit gating | **Story 3.3** |
| Result page UI — dual-panel shell, rendering `finalScore`/`breakdown`/`categoryBreakdown`/`insights`, the empty/disabled chat slot | **Story 3.2** |
| `GenerateQuizUseCase`, question pool generation, category selection, stratified draw | **Epic 2 (Stories 2.4/2.5/2.6)** — already complete; consume their output only |
| `documents`/`questions`/`answers` tables, `quiz_sessions.selected_categories`, migrations `0000`–`0002` | **Stories 1.3/1.4/2.6** — do not renumber or regenerate |
| `chat_messages` table, chat cache prefix, chat context assembly (which will read this story's `insights`/`breakdown`/`categoryBreakdown` output as system content) | **Story 4.1 (Epic 4)** |
| Tavily web search, dual-LLM summarization | **Story 4.2 (Epic 4)** — and explicitly **not** used here; insights are computed with zero network/LLM calls (AC #14) |
| `enrich(sessionId, userId)`, the `onCommit` hook on `identity.interceptor.ts` | **Story 2.6** — this story does not call or extend either; submit has no async post-commit work in v1 |
| Rate limiting table, CORS, helmet, `SafeExceptionFilter`'s baseline shape/envelope | **Story 1.5** — this story only *extends* the filter's existing error registry (Task 9) |

⚠️ **Do not re-implement any scoring formula.** `scoreQuestion`, `weightedFinalScore`, `geometricWeights`, `aggregateByCategory`, `rankWeakCategories`, `strengthFor` are Story 1.2's, fully tested at ≥95% coverage. If a number looks wrong, the bug is almost certainly in how this story calls those functions (wrong `position`, wrong `n`), not in the functions themselves.

### Architecture compliance (binding)

- **AD-1/AD-2 — hexagonal.** `SubmitAnswersUseCase`, `category-aggregator.service.ts`, `topic-snippet-matcher.ts` all live under `apps/api/src/domain/` and import nothing from `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, `node:fetch`. All I/O goes through `QuizRepositoryPort` (existing) and the new `SubmissionRepositoryPort`.
- **AD-3 — Zod DTOs, "one schema per boundary."** This story is the second major exercise of the row/request/wire split (after Story 2.6's `documents`/`questions`/`answers`): `UserResponseRowSchema` (row) ≠ `SubmitRequestSchema` (inbound wire) ≠ `SubmitResponseSchema`/`QuestionResultSchema` (outbound wire) ≠ `RevealedQuestionResponseSchema` (a *different* outbound wire schema, only valid post-submit). Do not collapse any of these into one schema "to save a file."
- **AD-9 — ownership + RLS.** The happy path (winning submit) rides the **existing** request transaction opened by `identity.interceptor.ts` — no new interceptor work needed. There is no failure-transaction case in this story (unlike Story 2.6's `UntrustedLlmOutputError` path) — a rejected submit (400/409) never partially writes anything, so there is nothing to protect against a rollback erasing.
- **AD-15 — submit idempotency + inline results.** This story is AD-15's primary implementation. The atomic-UPDATE-as-mutex design in Task 4 is this story's concrete realization of "the atomic UPDATE returns 0 rows... re-SELECT... recompute... return the same payload shape" — "recompute from DB" is satisfied by reading the already-persisted, already-computed rows (`user_responses`, `knowledge_categories`, `insights`), not by re-running `scoreQuestion` against a (possibly different) retried payload.
- **AD-16 — `knowledge_categories` single writer + zero-count exclusion.** This story **is** the sole writer named by AD-16. `aggregateByCategory` (Story 1.2) already refuses to emit a zero-question category — this story must not "helpfully" backfill one, e.g. for a category that was in `quiz_sessions.selected_categories` but drew 0 questions (AD-N4 permits that).
- **AD-N5 — complete submissions only.** The ID-set-exact-match check (Task 7) and the Zod `.min(1)` on `selected` (Task 1) together are what make `weightedFinalScore`'s contiguous-position invariant hold by construction — this story is where that invariant is actually enforced end-to-end for the first time (Story 1.2 only asserted it as a pure-function precondition).

### Resolving the `insights` writer + `topicsToStudy` shape (spine Deferred item N8)

The spine's own Deferred log names this story as the required resolver: *"The `insights` table has RLS and an ERD row but no named writer, and `topicsToStudy[]` has no element type or derivation rule beyond 'computed at submit'... resolve in Story 3.1 (`SubmitAnswersUseCase`)... the element shape must be pinned in `packages/shared/schemas.ts` before Story 4.1 consumes it in chat context."* This story resolves both:

- **Writer:** `SubmitAnswersUseCase`, via `SubmissionRepositoryPort.trySubmit`, INSERT-only (never UPSERT — the atomic-UPDATE gate means only one transaction ever reaches this INSERT per session, so there is no conflict to resolve).
- **`topicsToStudy[]` element shape:** `{ topic: string; reason: string; docSnippets: string[] }` (already literally specified in PRD FR-7 — the gap was the *derivation*, not the shape). Derivation is now pinned: deterministic, no LLM, no Tavily (AC #14) — `reason` is a template string over already-computed `avgRawScore`/`questionCount`; `docSnippets` is a token-overlap match against `documents.chunks` (persisted, plain `string[]`, per Story 2.2/2.6). This keeps `POST /submit` inside the same synchronous, single-request-transaction shape every other write in this app follows, and avoids inventing a second LLM-call budget class that no story's retry/tracing infrastructure accounts for.
- **Why not use `questions.explanation` for `docSnippets`:** Story 2.6 explicitly rules `explanation` stays `NULL` in v1 ("no active FR populates it... do not wire an LLM call to fill it"). Using it here would either resurrect that out-of-scope LLM call or silently produce empty snippets, so `documents.chunks` + question text is the only viable deterministic source already on disk.

### `GET /sessions/:id` response shape resolution (spine Deferred item N6, submitted case)

Deferred item N6 names Story 2.4 as resolving the `ready`-status wire projection (`QuizQuestionResponseSchema`, done). This story is the first to specify the **submitted**-status projection, since `GET /sessions/:id` on a submitted session did not exist before this story. Design ruling: `GET /:id` for `submitted` returns the base session fields **plus** `questions[]` (via the new `RevealedQuestionResponseSchema` — answers now safe to reveal) **plus** the same `finalScore`/`breakdown[]`/`categoryBreakdown[]`/`insights`/`actualCount?` fields `POST /submit` returns. This lets a user land directly on `/result/[id]` from history (Epic 5) without a second round trip and without `/quiz/[id]` having been visited first in the same browser session. `POST /submit`'s own response stays exactly the FR-7-literal `SubmitResponseSchema` shape (no question text/answer text embedded there) — the two endpoints intentionally return different projections for the same underlying data, which is allowed under AD-3's "one schema per boundary, not per entity."

### Data Model Contract

New tables (columns `snake_case` in Postgres, `camelCase` in Drizzle/Zod):

```
user_responses
  id              uuid PK default gen_random_uuid()
  session_id      uuid NOT NULL REFERENCES quiz_sessions(id)
  question_id     uuid NOT NULL REFERENCES questions(id)
  selected        jsonb NOT NULL          -- int[], positions 0..3, unique
  raw_score       numeric NOT NULL        -- 0..4
  weight          numeric NOT NULL
  weighted_score  numeric NOT NULL
  submitted_at    timestamptz NOT NULL default now()
  UNIQUE (session_id, question_id)

insights
  id          uuid PK default gen_random_uuid()
  session_id  uuid NOT NULL REFERENCES quiz_sessions(id)
  kind        text NOT NULL default 'gap_analysis'
  payload     jsonb NOT NULL   -- { topicsToStudy[], weakCategories[], strengthByCategory }
  sources     jsonb NULL       -- reserved; null in v1 (no Tavily at submit time)
  created_at  timestamptz NOT NULL default now()

knowledge_categories
  id               uuid PK default gen_random_uuid()
  session_id       uuid NOT NULL REFERENCES quiz_sessions(id)
  name             text NOT NULL
  question_count   integer NOT NULL
  correct_count    integer NOT NULL   -- rawScore === 4 iff correct (Story 1.2's resolved semantics)
  avg_raw_score    numeric NOT NULL
  weighted_score   numeric NOT NULL
  strength         text NOT NULL      -- 'strong'|'mixed'|'weak'
  UNIQUE (session_id, name)
```

`quiz_sessions.final_score` and `quiz_sessions.completed_at` (both already columns per Story 1.3/2.6) are written by this story for the first time — Story 2.6 explicitly left `completed_at` untouched and flagged it as "most plausibly belongs to the submit flow." Confirmed here: set on the winning `trySubmit` UPDATE.

### RLS migration contract — sequential numbering, do not renumber

Story 1.3 owns `0000` (`users`+`quiz_sessions`, no RLS). Story 1.4 owns `0001` (RLS on `quiz_sessions`). Story 2.6 owns `0002` (`documents`/`questions`/`answers` + RLS + `quiz_sessions.selected_categories`). This story is the next sequential migration — verify against whatever actually exists in `apps/api/drizzle/` at dev time (Epic 3's sibling stories 3.2/3.3 do not touch migrations, so no collision is expected, but confirm before generating).

### `set_config`, not `SET LOCAL` — same pattern as every prior story

Story 1.4's fix applies verbatim here: `await tx.execute(sql\`SELECT set_config('app.user_id', ${userId}, true)\`)` — `SET LOCAL` cannot bind parameters. This story's happy path reuses the **existing** request transaction (already GUC-scoped by `identity.interceptor.ts`), so no new `set_config` call is needed in this story's own code — call this out explicitly in review if a new one appears, since it would signal an unnecessary new transaction was opened where the existing one should have been reused.

### Anti-pattern watchlist

- ❌ Re-deriving `scoreQuestion`/`weightedFinalScore`/`geometricWeights` inline "for a small tweak" — always call Story 1.2's exports.
- ❌ Inserting `user_responses`/`knowledge_categories`/`insights` **before** the atomic status-transition UPDATE succeeds — reopens the unique-constraint race the atomic UPDATE exists to prevent (see Task 4).
- ❌ Adding an LLM or Tavily call anywhere in the submit path "to make the insights narrative nicer" — AC #14 and AD-15 are explicit that this is synchronous and pure; an LLM call here would also need its own retry/tracing budget that no story provisions.
- ❌ Materializing a `knowledge_categories` row for a category with 0 drawn questions "since it was in `selected_categories`" — directly reopens the NaN `avgRawScore` defect AD-16 exists to prevent.
- ❌ Treating `strengthByCategory` as a single value copied from `finalScore`'s overall strength — it is per-category, keyed by name (AC #7).
- ❌ Calling `enrich()` or touching `identity.interceptor.ts`'s `onCommit` hook — out of scope; submit is fully synchronous.
- ❌ Reusing `QuestionRowSchema`/`AnswerRowSchema` (which carry `isCorrect` unconditionally) as either wire response — always project through `RevealedQuestionResponseSchema` (submitted) or `QuizQuestionResponseSchema` (ready, Story 2.6).
- ❌ Regenerating or renumbering migrations `0000`–`0002`.

### Project Structure Notes

```
apps/api/src/
  domain/
    use-cases/SubmitAnswersUseCase.ts               NEW
    ports/submission-repository.port.ts              NEW
    quiz/services/category-aggregator.service.ts      NEW
    quiz/services/topic-snippet-matcher.ts            NEW
    quiz/errors/incomplete-submission.error.ts        NEW
    quiz/errors/session-not-ready.error.ts            NEW
  adapters/
    persistence/drizzle/
      schema.ts                                       UPDATE (append user_responses/insights/knowledge_categories)
      client.ts                                        UPDATE (numeric type parser, OID 1700)
      submission.repository.ts                         NEW
  driving/
    sessions/sessions.controller.ts                   UPDATE (POST :id/submit; GET :id submitted branch)
    middleware/safe-exception.filter.ts                UPDATE (+2 error mappings)
apps/api/drizzle/                                      NEW migration (user_responses/insights/knowledge_categories + RLS)
apps/api/test/domain/
  category-aggregator.test.ts                          NEW
  topic-snippet-matcher.test.ts                        NEW
apps/api/test/use-cases/submit-answers-use-case.test.ts NEW
apps/api/test/integration/submit.integration.test.ts    NEW
apps/api/test/security/
  rls-submission.security.test.ts                       NEW
  ownership-submission.security.test.ts                 NEW
apps/api/test/adapters/client-numeric-parser.test.ts     NEW
packages/shared/src/schemas.ts                          UPDATE (see Task 1)
```

Naming follows the spine's Consistency Conventions: kebab-case files, PascalCase classes, camelCase vars, `*.port.ts`/`*.adapter.ts`/`*.dto.ts` suffixes.

### Testing standards

- **Vitest.** Integration tests in `apps/api/test/integration/`, security tests in `apps/api/test/security/`, pure-domain tests in `apps/api/test/domain/` and `apps/api/test/use-cases/` — never colocated in `src/`.
- **Coverage floors (NFR-4/AD-N10):** use-cases ≥ 80%, adapters ≥ 60% (scoring ≥ 95% is already Story 1.2's, untouched here).
- **Real Postgres required** for the RLS and idempotency/race tests — do not mock the DB for anything asserting `FORCE ROW LEVEL SECURITY` or the atomic-UPDATE-as-mutex behavior; run the RLS test as the table-owner role, same pattern as Stories 1.4/2.6.
- **The concurrent-submit test is the highest-value test in this story** — it is the only test that actually proves the race design in Task 4 (two simultaneous `POST .../submit` calls against the same `ready` session; assert exactly one `knowledge_categories` row-set was written and both HTTP responses are 200 with identical bodies).
- No Playwright work here — no new UI surface (Stories 3.2/3.3 own it).
- Before completing: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify`.

### Cross-epic prior art (read in full before starting)

- **Story 1.2** — the scoring module this story is the primary consumer of. Resolved semantics this story must match, not re-derive: `correctCount` counts iff `rawScore === 4`; `rankWeakCategories` sorts ascending `avgRawScore`, tie-break ascending `name`; categories compare by `avgRawScore` never `weightedScore`.
- **Story 1.3** — `client.ts`'s `pg.Pool`, and the exact open question this story closes (numeric-as-string).
- **Story 1.4** — `identity.interceptor.ts`, `getRequestContext()`, `set_config(...)` pattern, `@OwnsSession()`, `NotFoundError → 404`, the RLS depth-1 policy template, `@ai-quiz/no-unscoped-session-query`.
- **Story 1.5** — `SafeExceptionFilter`'s domain-error registry (this story's Task 9 extends it a second time, after Story 2.6's first extension).
- **Story 2.6** — the closest sibling in shape: same migration-sequencing discipline, same "wire ≠ row" schema split, same RLS depth-1 policy pattern, same `SafeExceptionFilter` extension mechanism. Also the story that ruled `explanation` stays `NULL` (informs this story's `docSnippets` design) and that named this story as the owner of the `knowledge_categories`/`insights` writer questions.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-3.1-Submit-score--serve-results] — the ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-Take-the-quiz--get-graded-results-with-insights] — epic ordering note (backend → result shell → quiz UI)
- [Source: .../ARCHITECTURE-SPINE.md#AD-15] — submit idempotency + inline results+insights, atomic UPDATE, 409 rule
- [Source: .../ARCHITECTURE-SPINE.md#AD-16] — multi-answer scoring, single-writer rule, zero-count exclusion
- [Source: .../ARCHITECTURE-SPINE.md#AD-N5] — complete submissions only
- [Source: .../ARCHITECTURE-SPINE.md#AD-9] — ownership/RLS pattern, `set_config`
- [Source: .../ARCHITECTURE-SPINE.md#AD-3] — row/request/wire schema split
- [Source: .../ARCHITECTURE-SPINE.md#Deferred] — item N8 (`insights` writer + shape, explicitly assigned to this story), item N6 (wire-projection ownership), item N5 (enrichment recompute clause, declared moot here)
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-7] — literal `SubmitResponse` TypeScript shape
- [Source: prd.md#FR-17] — complete submissions, empty-selection 400
- [Source: prd.md#NFR-8] — scoring math invariants
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.5-Data-Model] — `user_responses`/`insights`/`knowledge_categories` columns
- [Source: architecture-spec.md#A.7-Agent-Flows] — the stale "LLM step" gap-analysis narrative this story explicitly supersedes (AC #14)
- [Source: architecture-spec.md#A.9-Scoring-Module] — function signatures this story consumes verbatim
- [Source: _bmad-output/implementation-artifacts/1-2-scoring-engine-in-packages-shared-fully-tested.md] — resolved scoring semantics + the flagged `strengthByCategory` shape bug this story fixes
- [Source: _bmad-output/implementation-artifacts/1-3-api-skeleton-db-foundation-and-health-endpoints.md] — the numeric-as-string open question this story closes
- [Source: _bmad-output/implementation-artifacts/1-4-per-session-ownership-walking-skeleton-sessions-endpoint.md] — `set_config`, RLS template, ownership pattern
- [Source: _bmad-output/implementation-artifacts/1-5-network-hardening-rate-limiting-cors-helmet-error-shape.md] — `SafeExceptionFilter` registry shape
- [Source: _bmad-output/implementation-artifacts/2-6-persist-the-quiz-failure-state-and-enrichment.md] — migration `0002`, wire/row split precedent, `explanation` stays NULL ruling, `onCommit` hook (not used here)
- [Source: _bmad-output/project-context.md#Scoring-Rules], [#Security-Rules rule 8]
- [Source: AGENTS.md#Security] — submit idempotency + inline results/insights summary; scoring invariants

### Open questions / spec gaps (non-blocking — flagged for the human)

1. **`sources` column on `insights` is unused in v1.** The ERD carries it (`jsonb`, nullable) but nothing populates it — `docSnippets` live inside `payload.topicsToStudy[].docSnippets` instead. Kept nullable/unused rather than removed, since the column costs nothing and Story 4.2's Tavily work might want a home for chat-sourced citations later; confirm this is acceptable or repurpose in Epic 4.
2. **`topicsToStudy` scope (weak-only, not weak+mixed) is this story's own ruling**, not a citation — no source document says whether `mixed` categories get study topics. If product wants `mixed` included later, `buildInsights`'s category-selection line is the single point of change.
3. **`docSnippets` similarity heuristic duplicates the spirit of Story 2.4's grounding check** rather than reusing its code, to avoid editing a concurrently-authored sibling story's file. If Story 2.4 lands with an exported, reusable token-overlap utility, a follow-up refactor could consolidate — not done here to avoid a merge conflict.
4. **AD-N2's "`knowledge_categories` aggregate recomputation" enrichment clause** is declared moot by this story (AC #16) but the spine document itself is not edited here (out of this story's file-scope). Flag for whoever next regenerates `ARCHITECTURE-SPINE.md` to drop that clause from AD-N2.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
