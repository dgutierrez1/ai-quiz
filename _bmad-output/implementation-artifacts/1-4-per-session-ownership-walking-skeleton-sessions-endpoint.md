# Story 1.4: Per-session ownership + walking-skeleton sessions endpoint

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want every session-scoped request verified as mine at both the app and database layers,
so that no one can read or mutate another user's session.

## Acceptance Criteria

1. **Format rejection (400, no DB).** Given a request without a valid **UUID v4** `X-User-Id` on any authenticated route, `user-id.middleware.ts` rejects it with **400** before any DB query or transaction is opened. Regex is the canonical v4 form: `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` (loose 8-4-4-4-12 is forbidden — it admits v1/v3/v5/v7). [AD-N7]
2. **Identity + transaction + GUC on every authenticated route.** Given a valid `X-User-Id`, `identity.interceptor.ts` upserts `users` by `external_id`, resolves the internal `users.id`, opens the request transaction, sets the `app.user_id` GUC transaction-locally, and propagates the transaction handle via **AsyncLocalStorage** so the use-case's Drizzle queries run on the **same connection and transaction**. This runs on **every** authenticated route, not just `:id`-scoped ones.
3. **The GUC carries `users.id`, never the raw header.** `X-User-Id` is `users.external_id` (`text`, browser-generated); `quiz_sessions.user_id` FKs to `users.id` (`uuid`). A test asserts the value written to the GUC equals the internal `users.id` and **not** the request header value.
4. **Upsert uses `DO UPDATE`, never `DO NOTHING`.** `INSERT ... ON CONFLICT (external_id) DO UPDATE SET external_id = EXCLUDED.external_id RETURNING id`. A test covers the concurrent-first-request race: two simultaneous requests with the same new `external_id` both receive a non-null `users.id`.
5. **The identity interceptor is the sole owner of the `users` upsert.** No other component creates `users` rows. Without it the first `POST /api/sessions` FK-violates on `quiz_sessions.user_id`.
6. **`POST /api/sessions` (no `:id`) still gets the GUC.** Given the stub `POST /api/sessions`, the GUC is set by the identity interceptor, so the initial `INSERT` into `quiz_sessions` passes the RLS `WITH CHECK`. A test asserts session creation succeeds — binding the GUC to `@OwnsSession()` alone would reject the first write of every session.
7. **Stub `POST /api/sessions` persists and returns.** Given a valid request, it persists a `quiz_sessions` row owned by the caller (`status = 'pending'`) and returns its `id` with **201**.
8. **`GET /api/sessions/:id` returns 404 for not-owned and not-found alike.** Given a session owned by another user, or a well-formed UUID that does not exist, the route returns **404** (never 403, never 200) via `sessionRepo.findByIdAndUserId(sessionId, userId)` → `NotFoundError`. Existence-leak prevention: the two cases are indistinguishable in status, body, and timing class.
9. **RLS migration on `quiz_sessions`.** The migration creates `current_session_user_id()` (`LANGUAGE sql STABLE`), and applies `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + the `user_owns_session` policy to `quiz_sessions`. `users` is **NOT** RLS-governed (it is the table policies resolve _through_; a policy on it would be circular).
10. **RLS fails closed with the GUC unset.** Given a direct `SELECT * FROM quiz_sessions` on a connection where `app.user_id` was never set, **0 rows** are returned even though rows exist. Test runs as the table-owner role to prove `FORCE` is doing its job.
11. **`@OwnsSession()` interceptor exists and is applied to `:id`-scoped routes.** It is a distinct component from identity (identity = _who you are_; ownership = _whether this row is yours_), registered on `GET /api/sessions/:id`.
12. **Lint rule `@ai-quiz/no-unscoped-session-query`.** Given a `WHERE session_id = ?` query written outside a `forUser*` context or without an `assertUserOwns(...)` call, the ESLint rule fails the build. The rule ships with **known-good and known-bad fixtures** and its own unit test (ESLint `RuleTester`).
13. **Ownership security test.** `apps/api/test/security/ownership.security.test.ts`: user A creates a session; user B `GET`s it and receives 404. Green in `pnpm verify`.

## Tasks / Subtasks

- [ ] **Task 1 — Zod schemas for this boundary set** (AC: #2, #7, #8)
  - [ ] In `packages/shared/src/schemas.ts` add **distinctly named per-boundary** schemas (AD-3 clarification — one schema per BOUNDARY, not per entity):
    - `UserRowSchema` (`id`, `externalId`, `createdAt`)
    - `QuizSessionRowSchema` (DB row shape — see Data Model below; `strategy`/`provider`/`model` nullable at this stage, they become required in Epic 2)
    - `CreateSessionRequestSchema` — **stub scope only**: `{ sourceUrl: string().url() }` optional-tolerant; do **not** implement the full Epic-2 request contract (`strategy`, `questionCount`, `provider`, `model`) here
    - `SessionCreatedResponseSchema` (`{ id: uuid, status: 'pending' }`)
    - `UserIdHeaderSchema` — the canonical **v4** regex from AC #1, exported so middleware and tests share one definition
  - [ ] Do **not** reuse one `QuizSessionSchema` across row/request/wire boundaries — that conflation is the documented cause of two prior defects (AD-3).

- [ ] **Task 2 — Ports and domain errors** (AC: #2, #5, #8)
  - [ ] `apps/api/src/domain/ports/user-repository.port.ts` — `upsertByExternalId(externalId: string): Promise<UserDto>`
  - [ ] `apps/api/src/domain/ports/quiz-repository.port.ts` — `createSession(input): Promise<QuizSessionDto>`, `findByIdAndUserId(sessionId: string, userId: string): Promise<QuizSessionDto | null>`
  - [ ] Type the two id params so they are **not interchangeable** (branded types or at minimum a documented `InternalUserId` alias). `findByIdAndUserId` takes `users.id`, never `external_id`.
  - [ ] `apps/api/src/domain/quiz/errors/not-found.error.ts` — `NotFoundError`; mapped to HTTP 404 by the exception layer.
  - [ ] Ports and errors import **nothing** from `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, `node:fetch` (AD-2; ESLint enforces).

- [ ] **Task 3 — Drizzle schema additions + RLS migration** (AC: #9, #10)
  - [ ] Confirm Story 1.3's `users` + `quiz_sessions` tables match the Data Model below; add the `idx_quiz_sessions_user_id_created_at` index (the RLS `EXISTS` subquery and the app-layer `WHERE user_id = ?` both ride it).
  - [ ] New migration in `apps/api/drizzle/`:
    ```sql
    CREATE OR REPLACE FUNCTION current_session_user_id() RETURNS uuid
    LANGUAGE sql STABLE AS $$ SELECT current_setting('app.user_id', true)::uuid $$;

    ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE quiz_sessions FORCE  ROW LEVEL SECURITY;

    CREATE POLICY user_owns_session ON quiz_sessions
      USING (user_id = current_session_user_id());
    ```
  - [ ] **Scope guard:** only `quiz_sessions` exists at this point (Story 1.3 seeds `users` + `quiz_sessions`; the other seven owned tables land in Epic 2/3/4). Do **not** write `ALTER TABLE documents ...` etc. — the migration would fail on a non-existent relation. See _Spec Gap G1_ in Dev Notes; carry the depth-1/depth-2 template forward as documentation, not as executable SQL.
  - [ ] Keep `missing_ok` (`current_setting('app.user_id', true)`) — an unset GUC must yield NULL → policy false → 0 rows (fail-closed but silent, deliberately; AD-9).
  - [ ] Verify the migration runs under `node dist/main.js migrate` (Story 1.3's `release_command` path).

- [ ] **Task 4 — `user-id.middleware.ts` (format validation only)** (AC: #1)
  - [ ] `apps/api/src/driving/middleware/user-id.middleware.ts`. Validate `X-User-Id` against `UserIdHeaderSchema`. Reject with **400** in the `SafeExceptionFilter` envelope shape `{error: {code, message, requestId}}`.
  - [ ] **No DB access. No transaction.** This is the cheapest possible rejection point and its position as _middleware_ is what lets Story 1.5's throttler guard run before any transaction opens.
  - [ ] Apply to all authenticated routes; exclude `/healthz` and `/api/health` (AD-20 — those are unauthenticated).

- [ ] **Task 5 — `identity.interceptor.ts` (identity + transaction + GUC + ALS)** (AC: #2, #3, #4, #5, #6)
  - [ ] `apps/api/src/driving/middleware/identity.interceptor.ts`.
  - [ ] Open `db.transaction(async (tx) => { ... })`; inside it:
    1. Upsert user: `INSERT INTO users (external_id) VALUES ($1) ON CONFLICT (external_id) DO UPDATE SET external_id = EXCLUDED.external_id RETURNING id`
    2. **Set the GUC with `set_config`, not literal-interpolated `SET LOCAL`** — see _Critical Implementation Note_ in Dev Notes:
       `await tx.execute(sql\`SELECT set_config('app.user_id', ${userId}, true)\`)`
    3. Run the handler inside `AsyncLocalStorage.run({ tx, userId }, ...)`.
  - [ ] The interceptor **owns transaction lifetime**: commit on success, roll back on any thrown error.
  - [ ] Expose a `getRequestContext()` helper (`{ tx, userId }`) that the Drizzle repositories call so they bind to the same `tx` — a repository that grabs a fresh pool connection will not see the GUC and will silently return 0 rows.
  - [ ] Add an explanatory comment recording _why_ this is an interceptor and not middleware (ordering: middleware → guards → interceptors → handler; identity-as-middleware would open a transaction before Story 1.5's throttler guard could reject a flood).

- [ ] **Task 6 — `own-session.interceptor.ts` (`@OwnsSession()`)** (AC: #8, #11)
  - [ ] `apps/api/src/driving/middleware/own-session.interceptor.ts` + the `@OwnsSession()` decorator.
  - [ ] Resolves `:id` from route params, reads `userId` from the ALS context, calls `findByIdAndUserId`, throws `NotFoundError` when null.
  - [ ] Applied to `GET /api/sessions/:id`. Not applied to `POST /api/sessions` (no `:id` — the whole reason identity is a separate component).

- [ ] **Task 7 — Drizzle repositories (canonical adapter pattern)** (AC: #2, #7, #8)
  - [ ] `apps/api/src/adapters/persistence/drizzle/user.repository.ts` and `quiz-session.repository.ts`.
  - [ ] Every method ends `return Object.freeze(XRowSchema.parse(rows[0]))` — raw drizzle rows never escape the adapter (AD-3).
  - [ ] Both bind to the ALS `tx`, never to a fresh connection.

- [ ] **Task 8 — Stub `POST /api/sessions` + `GET /api/sessions/:id`** (AC: #6, #7, #8)
  - [ ] `apps/api/src/driving/sessions/sessions.controller.ts` (global prefix `api`, so route decorators are `@Controller('sessions')`).
  - [ ] `POST` → persists `quiz_sessions` row with `status = 'pending'`, returns `201 { id, status }`. **Stub only** — no ingest, no LLM, no question generation. Those are Epic 2.
  - [ ] `GET /:id` → `@OwnsSession()`, returns the session row (no questions — that table does not exist yet).
  - [ ] `ZodValidationPipe` on the request body.
  - [ ] Register `SessionsModule` in `AppModule` **before** any future `MastraModule.register()` entry (AD-7 — Mastra's catch-all `@All('*')` must remain last; it is not wired until Epic 2 but do not create an ordering that breaks later).

- [ ] **Task 9 — ESLint rule `@ai-quiz/no-unscoped-session-query`** (AC: #12)
  - [ ] Implement in the local ESLint plugin created by Story 1.1; wire into the root flat config.
  - [ ] Fails on a `WHERE session_id = ?` / `eq(x.sessionId, ...)` clause outside a `forUser*`-named function and without an `assertUserOwns(sessionId, userId)` call in scope.
  - [ ] `RuleTester` unit test with explicit **valid** and **invalid** fixtures.
  - [ ] Rationale to preserve in a comment: lint catches the failure mode at dev time; RLS catches it at runtime if lint is bypassed (raw SQL outside ESLint's reach). **Both are required — neither alone is sufficient.**

- [ ] **Task 10 — Tests** (AC: #1, #3, #4, #6, #8, #10, #12, #13)
  - [ ] `apps/api/test/security/ownership.security.test.ts` — user A vs user B → 404 (AC #13); not-found UUID → 404, byte-identical body shape to the not-owned case (AC #8).
  - [ ] `apps/api/test/security/rls.security.test.ts` — direct select with GUC unset → 0 rows, executed as the table owner (AC #10).
  - [ ] `apps/api/test/integration/identity.interceptor.test.ts` — GUC holds `users.id` not the header (AC #3); concurrent first-request race both resolve (AC #4); `POST /api/sessions` succeeds proving the `WITH CHECK` path (AC #6).
  - [ ] `apps/api/test/integration/user-id.middleware.test.ts` — malformed, missing, and **non-v4** (v1/v7) UUIDs all → 400 with zero DB queries observed (AC #1).
  - [ ] Use-case coverage ≥ **80%**, adapter coverage ≥ **60%** (NFR-4 floors, enforced in `pnpm verify`).
  - [ ] Run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test` before marking done.

## Dev Notes

### Pinned stack for this story — use these, add nothing else

| Concern         | Pinned choice                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework       | **NestJS 11.1.28** on `@nestjs/platform-express` (Fastify forbidden — Mastra adapter incompatibility). ⚠️ Not NestJS 10; `project-context.md` carried a stale "10" until 2026-07-19. |
| ORM / DB        | **Drizzle ORM 0.45.2** only. No raw `pg` client, no second ORM. Migrations via `drizzle-kit`. `sql` template tag with `$1/$2` placeholders.                                          |
| Validation      | **Zod**, schemas in `packages/shared/src/schemas.ts` — single source of truth for DB rows, HTTP bodies, and LLM JSON.                                                                |
| Runtime         | Node **≥ 22.22.1** (pinned in `engines` by Story 1.3).                                                                                                                               |
| Request context | Node built-in `node:async_hooks` **`AsyncLocalStorage`**. Do **not** add `nestjs-cls` or any third-party ALS wrapper.                                                                |
| Tests           | **Vitest**. No Jest.                                                                                                                                                                 |
| Postgres        | Local: `docker-compose.yml` Postgres 16 (Story 1.1). Prod: Neon, `?sslmode=require`, `statement_timeout: 10000`, `query_timeout: 15000`.                                             |

**Do not add:** Redis, BullMQ, any queue, any auth library, any session library, `passport`, or a UUID library beyond `crypto.randomUUID`.

### Previous-story context

No story files exist yet for 1.1–1.3 and the repo contains no implementation code — this is the first story file in the project. There is therefore no previous-story intelligence or git history to inherit. Treat the `UPDATE` entries in the source-tree table as _expected to exist_ from Stories 1.1–1.3; if any is missing when you start, that is a sequencing problem to surface, not something to scaffold from scratch inside this story.

### 🔴 Critical Implementation Note — use `set_config`, NOT interpolated `SET LOCAL`

The architecture documents write the GUC assignment as `SET LOCAL app.user_id = '<users.id>'`. **`SET LOCAL` does not accept bind parameters in PostgreSQL** — the value must be a literal, which would force string interpolation of a value into SQL. That collides head-on with AD-14 ("`sql` template tag uses `$1/$2` placeholders", no raw SQL assembly).

Use the functional equivalent, which **does** parameterize:

```ts
await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
```

The third argument `is_local = true` gives exactly `SET LOCAL` semantics — the value applies only to the current transaction and reverts on commit/rollback. Two consequences the dev agent must respect:

- **`SET LOCAL` / `is_local=true` outside an explicit transaction is a silent no-op** (emits a warning). The interceptor must therefore open `db.transaction(...)` _before_ setting it, even for a single read. If it doesn't, RLS sees no user and every query returns 0 rows with no error.
- Because the setting dies with the transaction, **any work after the response has no identity** — see the enrichment rule below.

Sources: [PostgreSQL SET docs](https://www.postgresql.org/docs/current/sql-set.html) · [set_config() — pgPedia](https://pgpedia.info/s/set_config.html) · [set_config is_local peculiarities](https://blog.bigsmoke.us/2022/06/24/postgresql-transaction-local-settings)

### The three-component split (AD-9, amended 2026-07-19) — get the ordering right

NestJS executes **middleware → guards → interceptors → pipes → handler**. That ordering is load-bearing, not incidental:

| #   | Component   | File                         | Responsibility                                                                    |
| --- | ----------- | ---------------------------- | --------------------------------------------------------------------------------- |
| 1a  | Middleware  | `user-id.middleware.ts`      | UUID-v4 **format only**. No DB. No transaction.                                   |
| 1b  | Guard       | `user-throttler.guard.ts`    | Rate limiting — **Story 1.5**, not this story. Runs before any transaction opens. |
| 1c  | Interceptor | `identity.interceptor.ts`    | `users` upsert + transaction + GUC + AsyncLocalStorage. Owns commit/rollback.     |
| 2   | Interceptor | `own-session.interceptor.ts` | `@OwnsSession()` ownership check, `:id` routes only.                              |

⚠️ **Do not collapse 1a and 1c into a single middleware.** If identity were middleware it would open a transaction _before_ the guard ran, and a malformed-UUID or unauthenticated flood would bypass Story 1.5's limiter entirely while hammering Postgres. This story must leave that seam clean for 1.5.

⚠️ **Terminology drift to expect:** `epics.md` Story 1.4 and PRD §10.1 both say "identity **middleware**". The spine's 2026-07-19 amendment and the source tree both place identity in `identity.interceptor.ts`. **The spine wins** — build the interceptor. Every AC written as "the identity middleware …" maps to `identity.interceptor.ts`.

### Why identity and ownership must be separate components

`POST /api/sessions` has no `:id`, so `@OwnsSession()` never fires. A policy written `USING (...)` with **no explicit `WITH CHECK`** reuses that expression for `INSERT` — so an unset GUC evaluates `user_id = NULL` → not true → **the first write of every session is rejected**. Setting the GUC in a universal identity component is what makes session creation possible at all. This is a fixed defect (`review-r3` F2), not a design preference.

### Why the GUC must carry `users.id`

- `X-User-Id` header = `users.external_id` — **`text`**, browser-generated.
- `quiz_sessions.user_id` = FK to `users.id` — **`uuid`** surrogate PK.

Setting the GUC from the raw header makes every policy compare an internal PK against a browser UUID: **false for every row of every user** — silent total lockout on reads, hard rejection on writes, while RLS _looks_ correctly enabled. The identity interceptor is the single translation point. `findByIdAndUserId` takes `users.id` and the signature must make the two non-interchangeable.

### `DO UPDATE`, never `DO NOTHING`

`ON CONFLICT (external_id) DO NOTHING` returns **no row** on a concurrent first-request race, leaving the GUC unset and every subsequent query in that request silently empty. Use `DO UPDATE SET external_id = EXCLUDED.external_id RETURNING id` — a self-assignment whose only purpose is to guarantee a `RETURNING` row.

### `users` is deliberately NOT RLS-governed

It is the identity table the policies resolve _through_; a policy on it would be circular. It is reachable only via `external_id`, which the caller already possesses. Do not add `ENABLE ROW LEVEL SECURITY` to `users`.

### Failure state must be written OUTSIDE the request transaction

The interceptor rolls back on any thrown error. Any future use-case that must **persist** a failure (e.g. `status='failed'` on `UntrustedLlmOutputError`, Epic 2) must write that row in its own separate, immediately-committed transaction _with its own `set_config`_ **before** throwing — otherwise the rollback erases the very row the UI renders. Not implemented in this story, but the `getRequestContext()` API must not make it impossible; expose a way to obtain a fresh independent transaction.

### Non-request paths must set the GUC themselves

The GUC lives in the request transaction and dies at commit. Any post-response work has **no identity** and would have every write rejected by `FORCE` RLS, silently. Rule for later epics: `enrich(sessionId, userId)` — capture `users.id` while still in request context, pass it in, open a fresh transaction, set the GUC before any write. Same for cron jobs and maintenance scripts: **no GUC, no writes.**

### `missing_ok` is intentional

`current_setting('app.user_id', true)` → unset yields NULL → policy false → 0 rows: fail-closed but silent. Chosen over fail-loud because RLS is the **backstop** layer; layer 3 (`findByIdAndUserId` → `NotFoundError` → 404) fails loudly and runs first, so the confusing silent-empty state is unreachable in normal operation. Do not "improve" this by dropping the second argument.

### `LANGUAGE sql STABLE`

Not `VOLATILE` — `STABLE` lets the planner hoist the helper out of per-row policy evaluation.

### 404, never 403

Both not-found and not-owned return **404** with an identical `{error: {code, message, requestId}}` body. A 403 confirms the resource exists — an existence leak. Do not differentiate the message strings either.

### Source tree components to touch

```
apps/api/src/
  domain/
    ports/user-repository.port.ts                   NEW
    ports/quiz-repository.port.ts                   NEW
    quiz/errors/not-found.error.ts                  NEW
  adapters/persistence/drizzle/
    user.repository.ts                              NEW
    quiz-session.repository.ts                      NEW
    schema.ts                                       UPDATE (index; verify 1.3 tables)
  driving/
    sessions/sessions.controller.ts                 NEW
    sessions/sessions.module.ts                     NEW
    middleware/user-id.middleware.ts                NEW
    middleware/identity.interceptor.ts              NEW
    middleware/own-session.interceptor.ts           NEW
  app.module.ts                                     UPDATE (register middleware/interceptors + SessionsModule)
apps/api/drizzle/                                   NEW migration (RLS)
apps/api/test/security/ownership.security.test.ts   NEW
apps/api/test/security/rls.security.test.ts         NEW
apps/api/test/integration/identity.interceptor.test.ts   NEW
apps/api/test/integration/user-id.middleware.test.ts     NEW
packages/shared/src/schemas.ts                      UPDATE
eslint-plugin (from Story 1.1)                      UPDATE (no-unscoped-session-query + fixtures)
```

**Files marked UPDATE are created by Stories 1.1–1.3.** Read each one fully before editing. In particular: `app.module.ts` (do not disturb import order — AD-7), `schema.ts` (do not redefine tables 1.3 already created), `schemas.ts` (append; do not rewrite Story 1.2's scoring DTOs), and the ESLint plugin (add a rule; do not restructure the plugin).

### Data model (as it exists after Story 1.3)

```
users
  id           uuid pk
  external_id  text unique      -- the browser X-User-Id
  created_at   timestamptz

quiz_sessions
  id, user_id (fk → users.id), source_url, topic, strategy,
  provider, model, status ('pending'|'ready'|'submitted'|'failed'),
  error_message, question_count, final_score, created_at, completed_at
  INDEX (user_id, created_at)   -- add in this story
```

Only these two tables exist. `documents`, `questions`, `answers`, `user_responses`, `insights`, `knowledge_categories`, `chat_messages` are created by their feature epics.

### RLS policy template for future tables (documentation, not executable here)

Carry this forward — each feature epic applies it when it creates its table. **Join depth is NOT uniform:**

```sql
-- Depth-1 (have session_id): documents, questions, user_responses,
--   insights, knowledge_categories, chat_messages
CREATE POLICY user_documents ON documents
  USING (EXISTS (SELECT 1 FROM quiz_sessions s
                 WHERE s.id = documents.session_id
                   AND s.user_id = current_session_user_id()));

-- Depth-2: answers has NO session_id, only question_id.
-- This is NOT "similar to" the depth-1 policies.
CREATE POLICY user_answers ON answers
  USING (EXISTS (SELECT 1 FROM questions q
                 JOIN quiz_sessions s ON s.id = q.session_id
                 WHERE q.id = answers.question_id
                   AND s.user_id = current_session_user_id()));
```

Every owned table needs both `ENABLE` **and** `FORCE ROW LEVEL SECURITY` — without `FORCE`, Neon's table-owner role bypasses RLS entirely and the policies are advisory only.

### Scope boundaries — what this story does NOT do

- ❌ No rate limiting / throttler guard → **Story 1.5**
- ❌ No CORS, helmet, body limits, `SafeExceptionFilter` implementation → **Story 1.5** (this story emits the `{error:{code,message,requestId}}` shape; if 1.5's filter doesn't exist yet, use a minimal local filter and let 1.5 replace it)
- ❌ No pino redaction, no Langfuse → **Story 1.6**
- ❌ No ingest, no LLM call, no question generation, no `strategy`/`questionCount`/`provider` validation → **Epic 2**. `POST /api/sessions` is a **stub**.
- ❌ No `apps/web` work. No `data-testid`, no Playwright.
- ❌ No RLS on tables that do not exist yet.

### Testing standards summary

- **Vitest.** Integration + security tests in `apps/api/test/`; security suite in `apps/api/test/security/`.
- Coverage floors enforced in `pnpm verify`: use-cases ≥ 80%, adapters ≥ 60% (scoring ≥ 95% is Story 1.2's).
- Tests need a real Postgres — use the `docker-compose.yml` instance from Story 1.1. RLS and `FORCE` behavior cannot be faked with mocks; the RLS test must connect as the **table-owner** role or it proves nothing.
- Domain unit tests must run in <100 ms (no I/O) — AD-2.
- `pnpm verify` = `lint:check && typecheck && test && test:e2e && build`.

### Project Structure Notes

- Naming follows the spine's Consistency Conventions: kebab-case files, PascalCase classes, camelCase vars, `*.port.ts` for ports, `*.adapter.ts` for adapters, `*.dto.ts` for DTOs. The spine's source tree lists `LlmPort.ts`-style PascalCase filenames under `ports/` — that contradicts the kebab-case convention in the same document. **Follow kebab-case** (the explicit convention table) and keep it consistent across the repo.
- Global prefix is `api` (`app.setGlobalPrefix('api')` from Story 1.3), so `@Controller('sessions')` yields `/api/sessions`. `epics.md` writes the routes as `POST /sessions` / `GET /sessions/:id`; the API contract in `architecture-spec.md §A.6` writes `/api/sessions`. **The `/api`-prefixed form is correct.** `/healthz` is deliberately outside the prefix.

### Spec gaps / conflicts resolved in this story

- **G1 — RLS migration scope.** AC text in `epics.md` describes policies for all eight owned tables (six depth-1 + `answers` at depth-2), but Story 1.3 creates only `users` + `quiz_sessions`. Writing the full migration here would fail on non-existent relations. **Resolution:** apply `ENABLE`/`FORCE`/policy to `quiz_sessions` only; carry the depth-1/depth-2 template as documentation for the feature epics. _This is the single most likely place for the dev agent to over-implement and break the migration._
- **G2 — `SET LOCAL` is unparameterizable.** Resolved to `set_config(..., true)` above. No planning artifact mentions `set_config`; every one of them writes the literal-interpolation form.
- **G3 — "identity middleware" vs `identity.interceptor.ts`.** Resolved in favour of the spine's interceptor.
- **G4 — route prefix.** Resolved in favour of `/api/sessions`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4: Per-session ownership + walking-skeleton sessions endpoint]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1: Foundation, Security Spine & Deployable Skeleton]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-9 — Ownership per request + Postgres RLS (v1)]
- [Source: .../ARCHITECTURE-SPINE.md#AD-3 — Zod DTOs at every boundary (canonical pattern)]
- [Source: .../ARCHITECTURE-SPINE.md#AD-2 — Domain purity]
- [Source: .../ARCHITECTURE-SPINE.md#AD-7 — Mastra catch-all MUST be last]
- [Source: .../ARCHITECTURE-SPINE.md#AD-14 — Drizzle-only persistence]
- [Source: .../ARCHITECTURE-SPINE.md#AD-N7 — Rate limiting (canonical v4 regex)]
- [Source: .../ARCHITECTURE-SPINE.md#AD-N10 — Testing discipline]
- [Source: .../ARCHITECTURE-SPINE.md#Consistency Conventions]
- [Source: .../ARCHITECTURE-SPINE.md#Minimal source tree]
- [Source: .../ARCHITECTURE-SPINE.md#Core entity ERD]
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.5 Data Model — Row Level Security (v1 — spine AD-9)]
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.6 REST API]
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#10.1 Security]
- [Source: _bmad-output/project-context.md#Security Rules — rule 2 (Per-endpoint ownership), rule 8 (Postgres security)]
- [Source: AGENTS.md#Security (release-blocking)]
- [External: https://www.postgresql.org/docs/current/sql-set.html]
- [External: https://pgpedia.info/s/set_config.html]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
