# Story 1.3: API skeleton, DB foundation & health endpoints

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want a NestJS API wired to the hexagonal layout with the base data schema, a migration runner, and health checks,
so that the service boots, connects to Postgres, and reports liveness.

## Acceptance Criteria

_(AD-1, AD-2, AD-3, AD-7, AD-8, AD-14, AD-20, NFR-3, NFR-6)_

1. **Given** the NestJS app, **Then** `apps/api/src` contains `domain/`, `domain/ports/`, `domain/use-cases/`, `adapters/`, `driving/`, **And** it boots on `@nestjs/platform-express` (never Fastify) with Node **`>= 22.22.1`** pinned in `package.json` `engines` _(corrected 2026-07-19: Mastra's floor is `>= 22.13.0`; `lint-staged@17.1.0` raises it to `>= 22.22.1`)_.
2. **Given** Drizzle setup, **Then** migrations create **only** the `users` and `quiz_sessions` tables (all child tables are deferred to their feature epics).
3. **Given** `node dist/main.js migrate`, **When** run, **Then** pending Drizzle migrations apply and the process exits `0` on success / non-zero on failure **without** starting the HTTP server (this is the `fly.toml` `release_command`).
4. **Given** `GET /healthz`, **Then** it returns 200 in ~1 ms, process-alive only — **no DB query, no I/O**, and it returns 200 even while Postgres is unreachable.
5. **Given** `GET /api/health`, **Then** it deep-checks DB reachability and returns 200 `{status:'ok', db:'up'}` when reachable / **503** `{status:'degraded', db:'down'}` when not, **And** Drizzle init retries up to 5× with exponential backoff.
6. **Given** the Neon connection, **Then** it requires `?sslmode=require` with `statement_timeout: 10000` and `query_timeout: 15000`.

### Additional acceptance criteria (derived from binding ADs — treat as equally required)

7. **Given** the global route prefix, **Then** `/api` is applied to all controllers **with `healthz` excluded**, so `GET /healthz` and `GET /api/health` both resolve (AD-20, §A.6 route table).
8. **Given** a DB that is unreachable at boot, **Then** the process still completes bootstrap and serves `/healthz` 200 in degraded mode — it must **not** crash or exit (AD-20: prevents the Fly kill-loop when Neon is cold-suspended).
9. **Given** `apps/api/src/domain/**`, **Then** no file imports `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, or `node:fetch`, and `pnpm verify` stays green against the Story 1.1 `no-restricted-imports` rule (AD-2).
10. **Given** the `quiz_sessions` table, **Then** index `idx_quiz_sessions_user_id_created_at` on `(user_id, created_at DESC)` exists (AD-9 cost note; consumed by Story 5.1).
11. **Given** `AppModule.imports`, **Then** the file carries the AD-7 comment marking the position where `MastraModule.register({mastra})` must be appended **last** in Epic 2 — no Mastra dependency is installed in this story.
12. **Given** the Vitest suite, **Then** `apps/api/test/` covers: `/healthz` without a DB, `/api/health` up + down branches, the `migrate` CLI (applies + is idempotent on second run), the pool timeout/SSL options, and the Drizzle↔Zod column-drift assertion; adapter coverage floor ≥ 60% (NFR-4).

## Tasks / Subtasks

- [ ] **Task 1 — `apps/api` package + hexagonal skeleton** (AC: #1, #9)
  - [ ] Create `apps/api/package.json` (name `@ai-quiz/api`, `"type"` consistent with the repo, `engines.node: ">=22.22.1"`); confirm the root `package.json` also pins the same value.
  - [ ] Install exact pinned versions (see Library & Version Contract below). `@nestjs/platform-express` is a **direct dependency**, not transitive. Do **not** install `@nestjs/platform-fastify`.
  - [ ] Create the directory tree exactly as specified in File Structure Contract below, including `apps/api/src/domain/tsconfig.json` (AD-2: the domain is an isolated directory with its own tsconfig, not a separate pnpm package).
  - [ ] `apps/api/tsconfig.json` extends `tsconfig.base.json` (strict + `noUncheckedIndexedAccess` + `noImplicitOverride` inherited).
  - [ ] Add `.gitkeep` (or a single index barrel) to the empty hexagonal dirs so the structure is committed.

- [ ] **Task 2 — Bootstrap (`main.ts`) + `app.module.ts`** (AC: #1, #3, #7, #8, #11)
  - [ ] `main.ts`: if `process.argv[2] === 'migrate'`, run the migration path (Task 4) and `process.exit(0|1)` **before** any `NestFactory.create` call — the release command must never bind a port.
  - [ ] Otherwise `NestFactory.create(AppModule)` with the **express** adapter, `app.setGlobalPrefix('api', { exclude: [{ path: 'healthz', method: RequestMethod.GET }] })`, listen on `process.env.API_PORT ?? 4000`.
  - [ ] Do **not** add helmet / CORS / body limits / `SafeExceptionFilter` / throttler here — Story 1.5 owns all of them. Do not add pino — Story 1.6 owns it.
  - [ ] `app.module.ts`: imports `ConfigModule` (global), `DatabaseModule`, `HealthModule`. Add the AD-7 comment block at the end of the `imports` array reserving the last slot for `MastraModule`.

- [ ] **Task 3 — Config + env contract** (AC: #6)
  - [ ] Zod-validate env at boot: `DATABASE_URL` (required, URL), `API_PORT` (int, default 4000), `NODE_ENV`. Fail fast with a readable message on a missing/invalid `DATABASE_URL` — this is a config error, not a runtime degradation, and is distinct from AC #8's _unreachable-DB_ case.
  - [ ] Assert `DATABASE_URL` carries `sslmode=require` when the host is not `localhost`/`127.0.0.1`; local docker-compose Postgres is exempt.
  - [ ] Add `DATABASE_URL`, `API_PORT`, `NODE_ENV` to `.env.example` (do not add LLM/Tavily/Langfuse keys — later stories own those lines).

- [ ] **Task 4 — Drizzle connection, retry, and migration runner** (AC: #2, #3, #5, #6, #8)
  - [ ] `adapters/persistence/drizzle/schema.ts` — Drizzle table definitions for `users` and `quiz_sessions` **only** (columns in the Data Model Contract below).
  - [ ] `adapters/persistence/drizzle/client.ts` — `pg.Pool` with `connectionString`, `ssl` per env, `statement_timeout: 10_000`, `query_timeout: 15_000`; wrap in `drizzle(pool, { schema })`.
  - [ ] Wrap pool acquisition + first `SELECT 1` in a **5-attempt exponential backoff** (e.g. 250 / 500 / 1000 / 2000 / 4000 ms). On exhaustion: log the failure, mark the module degraded, and **return normally** — never throw out of bootstrap (AC #8).
  - [ ] `drizzle.config.ts` at `apps/api/` → schema path above, `out: './drizzle'`, dialect `postgresql`.
  - [ ] Generate the initial migration into `apps/api/drizzle/` via `pnpm db:generate`; commit the generated SQL + journal.
  - [ ] `migrate.ts` — uses `migrate()` from `drizzle-orm/node-postgres/migrator` against `apps/api/drizzle`, on its own short-lived pool that it closes before exiting.
  - [ ] Wire root scripts `pnpm db:generate` / `pnpm db:migrate` if Story 1.1 left them as placeholders.

- [ ] **Task 5 — Health endpoints** (AC: #4, #5, #7)
  - [ ] `driving/health/health.controller.ts`: `@Get('healthz')` (registered on the prefix-excluded path) returns `{status:'ok'}` synchronously — **zero** awaits, zero DB access.
  - [ ] `@Get('health')` (resolves as `/api/health`) runs `SELECT 1` through the Drizzle client with a short timeout; 200 on success, **503** on failure, body `{status, db, uptime_s}`; include `process.memoryUsage()` **only when `NODE_ENV !== 'production'`** (AD-18).
  - [ ] Structure the deep check as a list of named sub-checks so Story 2.3 can append provider reachability without rewriting the controller.

- [ ] **Task 6 — Shared Zod row schemas + drift guard** (AC: #12)
  - [ ] In `packages/shared/src/schemas.ts`, add `UserRowSchema` and `QuizSessionRowSchema` if Story 1.2 has not already defined them. Use the **row**-suffixed names — AD-3 mandates distinct schemas per boundary; a request schema is Story 1.4/2.4's concern and must not reuse these.
  - [ ] `strategy` is a **required** enum (never nullable — AD-N4). There is **no `cost_spent` field** (removed 2026-07-19); adding one breaks every session read at the adapter boundary.
  - [ ] Add a Vitest assertion that the Drizzle table's column key set equals the Zod row schema's key set (AD-3 "silent shape drift" prevention).

- [ ] **Task 7 — Tests** (AC: #12)
  - [ ] `apps/api/test/health.integration.test.ts` — `/healthz` 200 with the DB stopped/unreachable; `/api/health` 200 up and 503 down.
  - [ ] `apps/api/test/migrate.integration.test.ts` — migration applies against a clean docker-compose Postgres, creates exactly `users` + `quiz_sessions` (+ the drizzle journal table), and a second run is a no-op.
  - [ ] `apps/api/test/db-client.test.ts` — pool options carry `statement_timeout: 10000` / `query_timeout: 15000`; retry helper attempts exactly 5× with growing delays; exhaustion resolves degraded rather than throwing.
  - [ ] `apps/api/test/bootstrap.test.ts` — the HTTP adapter is express; `/api` prefix applied with `healthz` excluded.
  - [ ] Run the full gate before completing: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify`.

## Dev Notes

### Scope boundary — read this first

This story is **infrastructure only**. It ends when the process boots, migrates, and reports health. The following are explicitly **NOT** in scope and belong to named later stories — implementing them here creates merge conflicts with agents working those stories concurrently:

| Do NOT build here                                                                                                                       | Owned by                |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `user-id.middleware.ts`, `identity.interceptor.ts`, `@OwnsSession()`, AsyncLocalStorage GUC, `POST /sessions` stub, `findByIdAndUserId` | **Story 1.4**           |
| **RLS migration** — `current_session_user_id()`, `ENABLE`/`FORCE ROW LEVEL SECURITY`, `user_owns_session` policy                        | **Story 1.4**           |
| Throttler, helmet, CORS, body limits, `SafeExceptionFilter`, `max_machines_running` boot guard                                          | **Story 1.5**           |
| pino + redaction, Langfuse port/adapter, Dockerfile, `fly.toml`, cron keep-warm, actual deploy                                          | **Story 1.6**           |
| Mastra install/registration, LLM adapter, `GET /api/config/providers`, provider sub-check in `/api/health`                              | **Epic 2**              |
| `documents`, `questions`, `answers`, `user_responses`, `insights`, `knowledge_categories`, `chat_messages` tables                       | **their feature epics** |

⚠️ **`users` and `quiz_sessions` ship WITHOUT RLS in this story.** Story 1.4 adds a follow-up migration that enables it. Do not pre-empt it: adding `FORCE ROW LEVEL SECURITY` here without the identity interceptor that sets `app.user_id` would make every write fail immediately (AD-9). Note also that **`users` is never RLS-governed at all** — it is the identity table the policies resolve _through_, so a policy on it would be circular.

### Architecture compliance (binding)

- **AD-1 / AD-2 — hexagonal.** `domain/`, `domain/ports/`, `domain/use-cases/` are pure. All DB code lives in `adapters/persistence/drizzle/`; all NestJS code lives in `driving/` (plus `main.ts` / `app.module.ts` as the composition root). The health controller is a driving-layer concern and may import the Drizzle client provider; **domain code must not**. Story 1.1's `no-restricted-imports` rule is the enforcement — if it fires, the fix is to move the file, never to relax the rule.
- **AD-3 — Zod DTOs at every boundary.** Adapters return `Object.freeze(Schema.parse(raw))`. This story has no repository methods yet, so the rule mainly binds Task 6: the Drizzle table and the Zod row schema are two views of one contract and must not drift. Use **`*RowSchema`** naming — the 2026-07-19 clarification is explicit that one entity legitimately has distinct row / request / wire schemas, and conflating them is what let a dropped column survive in a `.strict()` schema and throw on every read.
- **AD-7 — Mastra catch-all must be last.** No Mastra here, but leave the reserved comment so Epic 2 cannot get it wrong. `MastraModule` ships an `@All('*')` controller that shadows every route if imported anywhere but last.
- **AD-8 — runtime.** Node **`>= 22.22.1`** in `engines` _(corrected 2026-07-19: Mastra's floor is `>= 22.13.0`; `lint-staged@17.1.0` raises it to `>= 22.22.1`)_; `@nestjs/platform-express` only. Fastify is forbidden (the Mastra NestJS adapter does not support it) — choosing it now would be discovered as unfixable in Epic 2.
- **AD-14 — Drizzle-only persistence.** No other ORM, no raw `pg` client outside the Drizzle adapter directory. Migrations via `drizzle-kit`. TLS required.
- **AD-20 — two health endpoints, different jobs.** `/healthz` exists specifically so Fly's healthcheck does **not** depend on Neon. Neon free tier auto-suspends and wakes on connection; if `/healthz` touched the DB, a cold Neon would fail the Fly healthcheck and Fly would kill and restart the machine in a loop. This is the single most important behavioral rule in the story: **`/healthz` must never await anything.**

### Design rulings made here (spec was silent — follow these)

1. **Boot must not fail on an unreachable DB.** AC #5 mandates 5 retries but the source docs never state what happens after exhaustion. Ruling: log, mark degraded, continue bootstrap. Throwing would defeat AD-20's entire purpose (Fly would never receive a `/healthz` 200 and would kill-loop the machine). A _malformed/missing_ `DATABASE_URL` is different — that fails fast at config validation (Task 3).
2. **UUID default is `gen_random_uuid()`, not `uuid_generate_v4()`.** The spine's conventions table names `uuid_generate_v4()`, which requires the `uuid-ossp` extension. Postgres 16 (both Neon and the docker-compose image) provides `gen_random_uuid()` in core. Using it avoids an extension-creation step that can fail on a restricted role. _Variance from the spine convention line, recorded deliberately._
3. **Postgres driver is `pg` (node-postgres) via `drizzle-orm/node-postgres`.** `statement_timeout` and `query_timeout` (AD-14) are node-postgres `Pool` options; `query_timeout` in particular does not exist on `postgres.js`. This choice is forced by the timeout contract. Do not substitute `@neondatabase/serverless` — the deploy is a long-lived Fly process, not an edge function.
4. **No `@nestjs/terminus`.** Hand-roll the two controllers. Terminus is an unpinned dependency in the stack table and its indirection buys nothing for two checks; the sub-check list structure in Task 5 gives Story 2.3 the same extension point.

### Data Model Contract

Create **exactly** these two tables. Column names are `snake_case` in Postgres, `camelCase` in the Drizzle/Zod layer.

```
users
  id           uuid  PK   default gen_random_uuid()
  external_id  text  NOT NULL UNIQUE     -- the browser-generated X-User-Id
  created_at   timestamptz NOT NULL default now()

quiz_sessions
  id              uuid PK default gen_random_uuid()
  user_id         uuid NOT NULL REFERENCES users(id)
  source_url      text NOT NULL
  topic           text NULL                    -- bounded hint, ≤200 chars
  strategy        text NOT NULL                -- 'factual'|'comprehension'|'mixed'|'trivia'
  provider        text NOT NULL                -- 'minimax'|'openrouter'
  model           text NOT NULL                -- 'provider/model' string
  status          text NOT NULL                -- 'pending'|'ready'|'submitted'|'failed'
  error_message   text NULL                    -- set when status='failed'
  question_count  integer NOT NULL             -- 5..8
  final_score     numeric NULL
  created_at      timestamptz NOT NULL default now()
  completed_at    timestamptz NULL

INDEX idx_quiz_sessions_user_id_created_at ON quiz_sessions (user_id, created_at DESC)
```

Identity-model detail that matters downstream (AD-9): **`X-User-Id` is `users.external_id` (text), while `quiz_sessions.user_id` FKs to `users.id` (uuid).** They are deliberately different values. The FK column typing above is what makes Story 1.4's translation point enforceable — do not "simplify" by making `quiz_sessions.user_id` a text column holding the browser UUID.

⚠️ **No `cost_spent` column.** The per-session cost budget was removed 2026-07-19. If you see it referenced anywhere, that source is the frozen archive and is not authoritative.

Enum columns are stored as `text` (matching the ERD and §A.5), with the value set enforced by Zod at the boundary — not as Postgres `ENUM` types, which are painful to alter in later migrations.

### Library & Version Contract

Pin these versions; they were provider-verified on 2026-07-19 (today) in the spine's Stack table, so no further version research is needed.

| Package                          | Version                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/core`, `@nestjs/common` | `11.1.28`                                                                                                                    |
| `@nestjs/platform-express`       | `11.1.28` (must match the NestJS minor)                                                                                      |
| `@nestjs/config`                 | `^4` (peer-compatible with Nest 11)                                                                                          |
| `drizzle-orm`                    | `0.45.2`                                                                                                                     |
| `drizzle-kit`                    | latest matching `drizzle-orm` 0.45.x                                                                                         |
| `pg`                             | `8.x` (+ `@types/pg`)                                                                                                        |
| `zod`                            | `4.4.3`                                                                                                                      |
| `vitest`                         | `4.1.10`                                                                                                                     |
| Node                             | **`>= 22.22.1`** (Docker base `node:22-slim` — **never** `node:20`, which fails the engines check and breaks Mastra in prod) |
| Postgres                         | 16 (Neon free tier / local docker-compose)                                                                                   |

Zod is **v4** — `z.string().uuid()` style still works, but if you hit a deprecation prefer the v4 form (`z.uuid()`); do not downgrade to v3 to make an example compile.

### File Structure Contract

All paths are NEW (greenfield — no UPDATE files exist to read; the repo contains planning artifacts only).

```
apps/api/
  package.json                                  # engines.node >= 22.22.1
  tsconfig.json                                 # extends tsconfig.base.json
  drizzle.config.ts
  drizzle/                                      # generated migration SQL + journal (committed)
  src/
    main.ts                                     # migrate-mode branch, express adapter, global prefix
    migrate.ts                                  # drizzle-kit migrator entrypoint
    app.module.ts                               # AD-7 reserved-last comment for MastraModule
    config/
      env.ts                                    # Zod-validated env
    domain/
      tsconfig.json                             # AD-2 isolated domain tsconfig
      quiz/{dto,entities,services,errors}/      # created empty; populated by later stories
      ports/                                    # created empty
      use-cases/                                # created empty
    adapters/
      persistence/
        drizzle/
          schema.ts                             # users + quiz_sessions ONLY
          client.ts                             # pool + timeouts + 5x backoff
          database.module.ts
    driving/
      health/
        health.controller.ts                    # /healthz + /api/health
        health.module.ts
  test/
    health.integration.test.ts
    migrate.integration.test.ts
    db-client.test.ts
    bootstrap.test.ts
packages/shared/src/schemas.ts                  # ADD UserRowSchema + QuizSessionRowSchema (if absent)
.env.example                                    # ADD DATABASE_URL, API_PORT, NODE_ENV
```

Naming conventions (spine Consistency Conventions): kebab-case files, PascalCase classes, camelCase vars, `*.port.ts` for ports, `*.adapter.ts` for adapters, `*.dto.ts` for DTOs.

### Testing Requirements

- **Framework:** Vitest (`4.1.10`). Integration + security tests live in `apps/api/test/` (never colocated in `src/`); pure unit tests for shared code live in `packages/shared/test/`.
- **Coverage floors (NFR-4 / AD-N10):** adapters ≥ 60% — this story's code is almost entirely adapter/driving, so budget for it. Scoring ≥ 95% and use-cases ≥ 80% floors are untouched here.
- **Local Postgres:** integration tests run against the `docker-compose.yml` Postgres 16 from Story 1.1. If that file is missing, create the service — do not silently mock the DB for the migration test; an un-executed migration is the failure mode this AC exists to catch.
- **The `/healthz`-without-DB test is the highest-value test in this story.** Assert it by pointing the client at an unreachable `DATABASE_URL` (or stopping the container), not by mocking the controller — mocking would pass even if someone added an `await db.execute(...)` to the handler.
- **Do not add Playwright work here** — no web surface exists yet (Epic 2 Story 2.7 is the first UI).
- Before completing: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify` (`lint:check && typecheck && test && test:e2e && build`).

### Anti-pattern watchlist

- ❌ Adding a DB check to `/healthz` "for completeness" → Fly kill-loop (AD-20).
- ❌ Registering the global prefix without excluding `healthz` → `/healthz` silently becomes `/api/healthz` and the Fly healthcheck 404s.
- ❌ Creating child tables "while we're in the migration anyway" → they belong to feature epics with their own RLS policies; the `answers` policy in particular needs a depth-2 join and is easy to get wrong out of context.
- ❌ Enabling RLS here → every write fails until Story 1.4's identity interceptor exists.
- ❌ Starting the HTTP server in `migrate` mode → the Fly `release_command` hangs instead of exiting.
- ❌ Importing `drizzle-orm` from anywhere under `domain/` → ESLint failure (AD-2), and the fix is relocation, not a rule exception.
- ❌ Adding helmet/CORS/throttler "since we're in `main.ts`" → collides with Story 1.5, which is being written concurrently.
- ❌ Reaching for the archived `SPEC.md` for any rule → it is frozen, unmaintained, and superseded on several points. PRD + spine win.

### Project Structure Notes

- Aligns with spine "Minimal source tree" and `architecture-spec.md` §A.4 verbatim, with the single deliberate addition of `src/config/env.ts` (env validation has no named home in either tree, and inlining Zod env parsing into `main.ts` would put validation logic outside any layer).
- Build-order position: this is step 3 (`apps/api` skeleton) + step 4 (Drizzle schema + migrations, minus the RLS half) of the 17-step build order in §A.13.
- **Variance recorded:** `gen_random_uuid()` instead of the conventions table's `uuid_generate_v4()` (rationale in Design Ruling 2 above).
- No previous story files exist in `_bmad-output/implementation-artifacts/` and the repo contains no source code, so there is no previous-story intelligence or git history to inherit. Stories 1.1 (scaffold/tooling) and 1.2 (`packages/shared` scoring) are prerequisites being built concurrently — if `tsconfig.base.json`, `eslint.config.js`, `docker-compose.yml`, or `packages/shared/src/schemas.ts` is absent when you start, create the minimum needed and note it rather than duplicating those stories' scope.
- No UX design contract exists for this project, and this story has no UI surface — no UX artifacts apply.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.3-API-skeleton-DB-foundation--health-endpoints] — the six base ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-1-Foundation-Security-Spine--Deployable-Skeleton] — epic exit criterion; Stories 1.1/1.2/1.4/1.5/1.6 boundaries
- [Source: .../architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-1] — hexagonal layer table
- [Source: .../ARCHITECTURE-SPINE.md#AD-2] — domain purity, isolated domain tsconfig, `no-restricted-imports`
- [Source: .../ARCHITECTURE-SPINE.md#AD-3] — parse+freeze at boundaries; row vs request vs wire schema naming
- [Source: .../ARCHITECTURE-SPINE.md#AD-7] — `MastraModule` must be imported last
- [Source: .../ARCHITECTURE-SPINE.md#AD-8] — Node `>= 22.22.1`, `@nestjs/platform-express`, Fastify forbidden
- [Source: .../ARCHITECTURE-SPINE.md#AD-9] — identity/ownership split, `X-User-Id` = `users.external_id` vs `quiz_sessions.user_id` = `users.id`; RLS is Story 1.4
- [Source: .../ARCHITECTURE-SPINE.md#AD-14] — Drizzle-only, `sslmode=require`, `statement_timeout` / `query_timeout`
- [Source: .../ARCHITECTURE-SPINE.md#AD-18] — `/api/health` exposes `memoryUsage()` in non-prod
- [Source: .../ARCHITECTURE-SPINE.md#AD-19] — `node:22-slim`, `release_command` migrations, `max_machines_running=1`
- [Source: .../ARCHITECTURE-SPINE.md#AD-20] — two health endpoints, Fly healthcheck timings, 5-attempt Drizzle retry
- [Source: .../ARCHITECTURE-SPINE.md#Stack] — version table, verified 2026-07-19
- [Source: .../ARCHITECTURE-SPINE.md#Core-entity-ERD] — `users` + `quiz_sessions` columns
- [Source: .../ARCHITECTURE-SPINE.md#Minimal-source-tree] — directory layout
- [Source: .../ARCHITECTURE-SPINE.md#Consistency-Conventions] — naming, `pnpm` scripts, `pnpm verify` gate
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.5-Data-Model] — table column list + RLS section (RLS deferred to Story 1.4)
- [Source: .../architecture-spec.md#A.6-REST-API] — `/healthz` and `/api/health` route table
- [Source: .../architecture-spec.md#A.10-Environment] — `DATABASE_URL`, `API_PORT`
- [Source: .../architecture-spec.md#A.13-Build-Order] — steps 3–4
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#SM-4] — `/healthz` 200 within 30 s of boot
- [Source: _bmad-output/project-context.md#Technology-Stack] — NestJS 11.1.28 pin (not 10), `node:22-slim`
- [Source: _bmad-output/project-context.md#Security-Rules] — rule 8 Postgres security (TLS, timeouts)
- [Source: AGENTS.md#Stop-and-ask-before] — data-model changes, hexagonal boundary changes

### Open questions / spec gaps (non-blocking — flagged for the human)

1. **Migration granularity across concurrent stories.** Stories 1.3 and 1.4 both touch `apps/api/drizzle/`. This story generates migration `0000`; Story 1.4 must generate a **separate** `0001` for RLS rather than regenerating `0000`. If both agents regenerate, the journal conflicts.
2. **Zod row schema ownership.** Story 1.2's AC references `packages/shared/src/schemas.ts` but only names scoring DTOs. Task 6 assumes `UserRowSchema`/`QuizSessionRowSchema` may not exist yet and creates them. If 1.2 also creates them, reconcile to one definition — do not create a second.
3. **`final_score` numeric type.** The ERD says `numeric`. node-postgres returns `numeric` as a **string** by default, which will fail a `z.number()` row schema. Either configure a `pg` type parser for OID 1700 or type the Zod field as a coerced number. Not load-bearing until Story 3.1 writes the column, but the parser config belongs in `client.ts` (this story's file), so decide here.
4. **`/api/health` degraded semantics.** Returning 503 is this story's ruling; no source document states the code. If external monitoring is later configured to page on 503, confirm that a cold-suspended Neon (a normal, self-healing state on the free tier) producing 503 is acceptable.

## Dev Agent Record

### Agent Model Used

_(to be filled by the dev agent)_

### Debug Log References

### Completion Notes List

### File List
