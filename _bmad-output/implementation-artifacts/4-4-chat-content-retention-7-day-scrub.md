# Story 4.4: Chat content retention (7-day scrub)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want my raw chat content removed after a week,
so that a conversation about my learning gaps is not retained indefinitely.

## Acceptance Criteria

_(NFR-3, PRD §10.3, constitution rule 9)_ — carried forward verbatim from `epics.md#Story-4.4`:

1. **Given** `chat_messages` rows older than 7 days, **When** the scrub job runs, **Then** their `content` (and any `thinking` / `sources` payload) is nulled or replaced with a tombstone marker while the row, `role`, and `created_at` are retained for thread structure.
2. **Given** Langfuse, **Then** raw chat content in captured traces is scrubbed on the same 7-day boundary, leaving trace metadata intact.
3. **Given** the scheduling surface, **Then** the job is driven by the same external cron already required for the `/healthz` keep-warm ping (NFR-6) — no queue, no Redis, no BullMQ (constitution) — and is exposed as an idempotent, authenticated maintenance route.
4. **Given** the job runs twice over the same window, **Then** the second run is a no-op (idempotent).
5. **Given** a scrubbed session is revisited, **Then** the thread renders with tombstones rather than erroring, and the result/insights panels are unaffected.

### Additional acceptance criteria (derived from binding ADs + web-verified Langfuse capability — treat as equally required)

6. **Given** the chosen tombstone representation, **Then** it is: `content = NULL`, `sources = NULL`, `tool_calls = NULL`, `thinking = NULL`, plus a new `scrubbed_at timestamptz` column set to the scrub timestamp — **not** a sentinel string. `role`, `created_at`, `session_id`, `id` are untouched. `scrubbedAt !== null` is the single authoritative signal Story 4.3's UI must check to render a tombstone; it must never infer scrub state from `content` string-matching.
7. **Given** `POST /api/maintenance/scrub-chat` receives a missing or incorrect `X-Maintenance-Token`, **Then** it returns **401** through the standard `{error:{code,message,requestId}}` envelope and never reaches the DB or Langfuse calls (this is a system route, not a per-session route — the project's "404 never 403" convention governs ownership checks on `:id` routes and does **not** apply here; 401 is correct).
8. **Given** the scrub predicate `created_at < now() - interval '7 days' AND scrubbed_at IS NULL`, **When** the maintenance route is invoked twice in immediate succession, **Then** the second invocation's `chatRowsScrubbed` is `0` (idempotency test, not a run-log table).
9. **Given** a scrubbed row, **Then** it remains readable through the Story 4.1 `GET /api/sessions/:id/chat` endpoint without a Zod parse error — `ChatMessageDto`/`ChatMessageRowSchema` mark `content` nullable and add `scrubbedAt`.
10. **Given** Langfuse Cloud's actual, web-verified capability (see Research below: no per-field redaction API exists at any plan tier; configurable retention-days is a **Pro-plan-only** feature; the Hobby/free tier this project runs on has a **fixed, non-configurable** retention and no lever to set it to 7 days), **Then** the implementable mechanism is: discover trace IDs older than the 7-day cutoff via `GET /api/public/traces?toTimestamp=<cutoff>` and delete them in batches via `DELETE /api/public/traces` (Basic Auth, `LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY`). This deletes the **whole trace**, including metadata — see the flagged conflict with AC #2 in "Open questions / conflicts" below. Do not implement code that assumes a field-level Langfuse scrub API exists.
11. **Given** the cron surface, **Then** the *same* `.github/workflows/keep-warm.yml` file (owned by Story 1.6) gains one additional `schedule` cron entry plus a conditional step that calls the maintenance route — no second workflow file, no new scheduler, no queue/Redis/BullMQ is introduced.
12. **Given** the cross-user nature of the scrub (it must touch every user's stale rows, not one session), **Then** it is implemented as a loop over all `users.id` values, opening one short transaction per user with `SET LOCAL app.user_id = '<that user's id>'` before each `UPDATE` — reusing the **existing** AD-9 GUC mechanism (the same pattern `enrich(sessionId, userId)` already uses). **Do not** introduce a new Postgres role, `BYPASSRLS` grant, or second connection pool to bypass RLS — see "Design ruling" below for why this was considered and rejected.
13. **Given** `apps/api/test/`, **Then** it covers: the auth guard (missing/invalid token → 401, correct token → 200), the idempotency case (AC #8), the boundary case (a message exactly 7 days − 1 minute old is untouched; 7 days + 1 minute old is scrubbed), the tombstone shape surviving `GET .../chat`, and the Langfuse retention adapter against a **mocked** Langfuse client (no live network call in CI, consistent with Story 1.6's testing rule).

## Tasks / Subtasks

- [ ] **Task 1 — Migration: tombstone columns** (AC: #1, #6)
  - [ ] New Drizzle migration **after** Story 4.1's `chat_messages` migration (do not regenerate 4.1's file — generate a new one). Read Story 4.1's actual committed migration first; if `content` was created `NOT NULL` (per its AC wording, it is), add:
    ```sql
    ALTER TABLE chat_messages ALTER COLUMN content DROP NOT NULL;
    ALTER TABLE chat_messages ADD COLUMN scrubbed_at timestamptz NULL;
    ```
  - [ ] If Story 4.1 has not landed yet when you start, create `chat_messages` yourself from the epics.md Story 4.1 schema (session_id, role, content ≤8000, nullable sources/tool_calls/model/thinking, created_at, `INDEX (session_id, created_at)`, RLS `ENABLE`+`FORCE`+policy) **plus** this story's `scrubbed_at` column, and flag the duplication risk in your completion notes so Story 4.1's agent reconciles rather than creates a second migration for the same table.
  - [ ] No new table, no new RLS policy — `chat_messages` keeps its existing Story-4.1 RLS policy unchanged.

- [ ] **Task 2 — Domain port: `ChatRetentionPort`** (AC: #12)
  - [ ] `apps/api/src/domain/ports/ChatRetentionPort.ts` — pure interface, zero I/O imports (AD-2): `scrubUserChatContent(userId: string, cutoff: Date): Promise<{ scrubbedCount: number }>`.
  - [ ] Extend `UserRepositoryPort` with `listAllIds(): Promise<string[]>` if it does not already exist — purely additive, no signature changes to existing methods.

- [ ] **Task 3 — Use-case: `ScrubChatContentUseCase`** (AC: #1, #6, #8, #12)
  - [ ] `apps/api/src/domain/use-cases/ScrubChatContentUseCase.ts`. Pure orchestration: compute `cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)`; call `userRepositoryPort.listAllIds()`; for each id call `chatRetentionPort.scrubUserChatContent(id, cutoff)`; sum `scrubbedCount`; call `tracingPort.deleteTracesOlderThan(cutoff)`; return `{ chatRowsScrubbed, langfuseTracesDeleted, cutoff: cutoff.toISOString() }`.
  - [ ] No use-case may catch-and-swallow a per-user failure silently — log and continue to the next user (one user's failure must not block the rest), then surface an aggregate error count in the response if any occurred.

- [ ] **Task 4 — Drizzle adapter: per-user GUC scrub loop** (AC: #1, #6, #8, #12, #13)
  - [ ] `apps/api/src/adapters/persistence/drizzle/chat-retention.repo.ts` implements `ChatRetentionPort`. For each call: open a transaction, `SET LOCAL app.user_id = '<userId>'` (mirrors `enrich(sessionId, userId)` from AD-N2 exactly), then:
    ```sql
    UPDATE chat_messages
    SET content = NULL, sources = NULL, tool_calls = NULL, thinking = NULL, scrubbed_at = now()
    WHERE created_at < $1
      AND scrubbed_at IS NULL
    RETURNING id;
    ```
    (`$1` = the cutoff passed in; RLS's existing policy on `chat_messages` — `EXISTS (SELECT 1 FROM quiz_sessions s WHERE s.id = chat_messages.session_id AND s.user_id = current_session_user_id())` — already scopes this to the GUC'd user's rows. No extra join needed in the query text.)
  - [ ] Commit per user; a failure for one user rolls back only that user's transaction.
  - [ ] Return `{ scrubbedCount: rows.length }`.

- [ ] **Task 5 — Langfuse retention: extend `TracingPort` + `LangfuseAdapter`** (AC: #2, #10, #13)
  - [ ] Add `deleteTracesOlderThan(cutoff: Date): Promise<{ deletedCount: number }>` to `apps/api/src/domain/ports/TracingPort.ts` (Story 1.6).
  - [ ] Implement in `apps/api/src/adapters/observability/LangfuseAdapter.ts`: paginate `GET https://cloud.langfuse.com/api/public/traces?toTimestamp=<cutoff ISO>&page=N&limit=100` (Basic Auth `LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY`), collect `data[].id`, batch into groups of **≤ 30** (Langfuse's own guidance — do not send more per call), call `DELETE https://cloud.langfuse.com/api/public/traces` with the batch. **Verify the exact request/response JSON shape against `https://api.reference.langfuse.com/#tag/trace` (or `fern/apis/server/definition/trace.yml` in the `langfuse/langfuse` repo) at implementation time** — this story's research could not scrape the rendered OpenAPI schema (client-side rendered docs site); confirm the field name is `traceIds` before wiring it, ideally against a scratch Langfuse project first.
  - [ ] Add the same method to `NoopTracingAdapter.ts` (Story 1.6) returning `{ deletedCount: 0 }` — Langfuse-env-absent boot must still succeed (AD-N9 AC #4 from 1.6).
  - [ ] Deletion is asynchronous server-side (Langfuse: "typically within 15 minutes") — do not assert immediate absence in an integration test against a live instance; unit-test the adapter against a **mocked** HTTP client only (consistent with Story 1.6's "no network calls in CI").

- [ ] **Task 6 — Maintenance route + auth guard** (AC: #3, #7, #11)
  - [ ] `apps/api/src/driving/maintenance/maintenance-auth.guard.ts` — compares SHA-256 digests of the supplied `X-Maintenance-Token` header and `process.env.MAINTENANCE_TOKEN` via `crypto.timingSafeEqual` (hash first so both buffers are a fixed 32 bytes — avoids `timingSafeEqual`'s length-mismatch throw and keeps the comparison constant-time even when the header is absent or the wrong length). Missing header or mismatch → `UnauthorizedException` (401).
  - [ ] `apps/api/src/driving/maintenance/maintenance.controller.ts` — `POST /api/maintenance/scrub-chat`, guarded by `MaintenanceAuthGuard`, `@SkipThrottle()` (same rationale as `/healthz` in Story 1.5 Task 3 — this route is protected by a shared secret, not by the per-user/per-IP throttle model, and the GH Actions runner's rotating IP must not trip it). Calls `ScrubChatContentUseCase`, returns 200 with `{ chatRowsScrubbed, langfuseTracesDeleted, cutoff }`.
  - [ ] `apps/api/src/driving/maintenance/maintenance.module.ts` — registered in `AppModule` **before** `MastraModule` (AD-7). This route is **not** attached to `user-id.middleware`, `identity.interceptor`, or `@OwnsSession()` — it carries no `X-User-Id` and is not session-scoped. Read `app.module.ts`'s middleware `consumer.apply(...)` configuration (from Stories 1.4/1.5) before wiring this in; if `UserIdMiddleware` is applied globally to `*`, add an explicit `.exclude('maintenance/(.*)')`.
  - [ ] Add `MAINTENANCE_TOKEN` to `.env.example` (comment only, no value) and to the deploy runbook as a new Fly secret (`fly secrets set MAINTENANCE_TOKEN=...`) **and** a new GitHub Actions repo secret of the same value (the cron step needs it to call the route). This is a new production-affecting secret — flag it for human setup per `AGENTS.md` "Stop and ask before: adding a new deployment target or env var that affects production."

- [ ] **Task 7 — Cron wiring: extend the existing keep-warm workflow** (AC: #3, #11)
  - [ ] Edit `.github/workflows/keep-warm.yml` (Story 1.6). Add a second `schedule` entry, e.g. `- cron: '17 3 * * *'` (once daily; the existing `*/4 * * * *` entry is untouched), alongside the existing one in the same `on.schedule` list.
  - [ ] Branch on `github.event.schedule` inside the job: the `*/4 * * * *` trigger (or `workflow_dispatch`) runs the existing `curl -fsS --retry 1 "$API_URL/healthz"` step; the `17 3 * * *` trigger runs a new step: `curl -fsS -X POST "$API_URL/api/maintenance/scrub-chat" -H "X-Maintenance-Token: ${{ secrets.MAINTENANCE_TOKEN }}"`.
  - [ ] Do not create a second workflow file — the AC requires reusing the *same* cron surface, not merely the same mechanism.

- [ ] **Task 8 — Shared schema updates** (AC: #6, #9)
  - [ ] In `packages/shared/src/schemas.ts`, update `ChatMessageRowSchema` (Story 4.1): `content: z.string().max(8000).nullable()`, add `scrubbedAt: z.coerce.date().nullable()`.
  - [ ] Update the outbound wire DTO used by `GET /api/sessions/:id/chat` (Story 4.1) the same way — `content` nullable + `scrubbedAt` present — so Story 4.3's client can branch on `scrubbedAt !== null`.
  - [ ] Do **not** touch `insights`/`quiz_sessions` schemas — this story has zero effect on the result/insights payload (AC #5's second clause); add a short regression test asserting `GET /api/sessions/:id` (submit response shape) is unchanged when the session's chat rows are scrubbed.

- [ ] **Task 9 — Tests** (AC: #13)
  - [ ] `apps/api/test/maintenance/scrub-chat.integration.test.ts` — auth (401 missing/wrong token, 200 correct token); boundary (6d23h59m untouched, 7d00h01m scrubbed); idempotency (call twice, second `chatRowsScrubbed === 0`); tombstone shape (`content/sources/toolCalls/thinking` all null, `scrubbedAt` set, `role`/`createdAt`/`id`/`sessionId` unchanged); cross-user isolation (scrubbing user A's stale rows does not touch user B's fresh rows).
  - [ ] `apps/api/test/maintenance/tombstone-read.test.ts` — `GET /api/sessions/:id/chat` on a session with scrubbed rows returns 200 with no Zod parse error.
  - [ ] `apps/api/test/observability/langfuse-retention.test.ts` — mocked HTTP client; assert `GET ...toTimestamp=...` is called with the correct cutoff, batches of ≤30 IDs are sent to `DELETE`, and the no-op adapter returns `{deletedCount: 0}` without any network call.
  - [ ] Run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify` before completing.

## Dev Notes

### What this story owns vs. depends on

| Concern | Owner | Note |
|---|---|---|
| `chat_messages` table (session_id, role, content, sources, tool_calls, model, thinking, created_at, RLS policy) | **Story 4.1** | This story only *adds* `scrubbed_at` and relaxes `content`'s `NOT NULL` via a follow-up migration — it does not redefine the table. |
| `.github/workflows/keep-warm.yml` (the cron file itself) | **Story 1.6** | This story edits it (adds one schedule + one conditional step); it does not create a new workflow. |
| `SafeExceptionFilter` / `{error:{code,message,requestId}}` envelope | **Story 1.5** | The 401 from the auth guard must render through this same filter — do not hand-roll a different error shape. |
| `TracingPort` / `LangfuseAdapter` / `NoopTracingAdapter` (the interface + adapter files) | **Story 1.6** | This story extends them with one new method each; it does not replace them. |
| Chat panel tombstone rendering (UI) | **Story 4.3** | This story's job is to define and guarantee the `scrubbedAt`-based contract; rendering the tombstone bubble is 4.3's UI work. |
| Result/insights panels | **Epic 3 / Story 3.1** | Untouched by this story — no shared table, no shared query path. |

### Design ruling: why no `BYPASSRLS` role (spec was silent — follow this)

The obvious-looking design for a cross-user maintenance job is a dedicated Postgres role with `BYPASSRLS`, run over a second connection pool, doing one bulk `UPDATE ... WHERE created_at < cutoff` across every user at once. **This was considered and rejected.** Two reasons:

1. **AD-9 already has the exact mechanism this job needs.** `enrich(sessionId, userId)` (AD-N2) already proves the pattern: open your own transaction, `SET LOCAL app.user_id` before writing, commit. A cross-user job is just that pattern looped over every `users.id` (itself readable without any GUC — `users` is explicitly **not** RLS-governed per AD-9). No new privilege is required to make this work.
2. **A new `BYPASSRLS` role is a new, permanent security surface** for a job that runs once a day. It needs a new secret (`DATABASE_URL_MAINTENANCE` or equivalent), depends on Neon's default role having `CREATEROLE`-equivalent privilege to grant `BYPASSRLS` (unverified — some managed Postgres providers restrict this), and — per `AGENTS.md` "Stop and ask before: changing security controls" — is exactly the class of change that should not be introduced without discussion. The GUC-loop costs *N* short transactions instead of one bulk statement; at v1 demo scale that cost is negligible and is the conservative choice.

If a future story needs to relax this (user count large enough that the per-user loop is measurably slow inside the cron step's timeout), that is a revisit condition to record, not something to pre-empt here.

### Tombstone representation — the contract Story 4.3 depends on

**Chosen: null out fields + a dedicated `scrubbed_at` marker column, not a sentinel string.**

- `content = NULL`, `sources = NULL`, `tool_calls = NULL`, `thinking = NULL`, `scrubbed_at = now()`.
- `role`, `created_at`, `id`, `session_id` are never touched — this is what "retained for thread structure" means concretely.
- **Why not a sentinel string** (e.g. `"[content removed after 7 days]"`)? A string forces the UI to detect scrub state by content-matching, which is fragile (a user could legitimately type that exact string) and forces every future consumer of `chat_messages.content` to special-case a magic value instead of checking a boolean-like signal. A dedicated nullable column is the same pattern the ERD already uses for optional payloads (`sources`, `tool_calls`, `thinking`) and gives an unambiguous, typed signal (`scrubbedAt: Date | null`) plus a free audit trail (when it was scrubbed).
- **Story 4.3 contract:** the FE checks `message.scrubbedAt !== null` to render a tombstone bubble ("This message has been removed") instead of `message.content`. It must never attempt to render `null` as chat text.

### Langfuse research (web-verified 2026-07 — read before implementing Task 5)

- **No field-level redaction API exists at any plan tier.** Confirmed via Langfuse's own docs and an open (unresolved as of this research) maintainer discussion: ["Selective Deletion of Prompt and Response Text While Retaining Evaluation & Observability Metrics" (GitHub Discussion #8387)](https://github.com/orgs/langfuse/discussions/8387) — a maintainer states plainly: *"Deleting a trace removes all associated data—including evaluation metrics."* The only maintainer-acknowledged workaround is a **self-hosted** instance running scheduled ClickHouse/S3 queries to blank old fields directly — explicitly **not officially supported**, and irrelevant to this project (Langfuse Cloud free tier, per the architecture spine's deployment topology).
- **Configurable data retention (arbitrary days, ≥3) is a Pro-plan-only feature.** Per [Langfuse pricing](https://langfuse.com/pricing) and the [2025-01-30 changelog](https://langfuse.com/changelog/2025-01-30-data-retention): the free **Hobby** tier ships a fixed, non-configurable retention window (reported ~30 days in current Langfuse Cloud pricing pages); the *configurable* per-project retention-days setting used by [`docs/administration/data-retention`](https://langfuse.com/docs/administration/data-retention) requires Pro/Enterprise/Self-Hosted-EE. This project is $0/mo (constitution) and therefore **cannot** set project retention to 7 days via that mechanism at all.
- **What actually is implementable on the free tier:** manual deletion via the public API — `GET /api/public/traces?toTimestamp=...` to discover trace IDs older than the cutoff, then `DELETE /api/public/traces` in batches (Basic Auth with the existing `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`, already provisioned per Story 1.6). Deletion is asynchronous, completing in Langfuse's stated "~15 minutes." This is a **whole-trace delete**, which is what Task 5 implements.

### Open questions / conflicts

1. **AC #2 ("leaving trace metadata intact") cannot be honestly satisfied on this project's actual Langfuse plan.** The epics AC and `project-context.md` rule 9 / AD-N9 / PRD §10.3 all phrase this as "chat content scrubbed, metadata retained" — a field-level operation. Web research (above) confirms Langfuse provides **no such capability at any tier**, and the free Hobby tier this project runs on doesn't even offer the coarser configurable-retention lever (that's Pro-only). The only implementable lever — whole-trace deletion via the public Delete API — necessarily destroys the metadata the AC says must survive. **This is a genuine contradiction between the source docs' assumption and the vendor's actual capability, not a gap this story can close by writing better code.** Recommended resolutions, for a human to choose between (this story implements the first as the pragmatic default, since it satisfies "content is gone after 7 days" from PRD §10.3/rule 9 even though it over-deletes relative to the AC's literal wording):
   - **(a) Accept whole-trace deletion at 7 days** (what Task 5 builds). Chat traces vanish entirely from Langfuse after a week — no model/token/latency/cache-hit metadata survives either. This satisfies the content-scrub *intent* but not the letter of "leaving trace metadata intact."
   - **(b) Never send raw chat prompt/completion content to Langfuse in the first place** (use the Langfuse SDK's `mask` function at trace-creation time in Stories 4.1/4.2, sending only metadata from day one). This satisfies "metadata intact" trivially — because nothing sensitive is ever there — but means chat content is never inspectable in Langfuse even for debugging within the 7-day window, which is a product/observability trade-off no source document has made explicitly.
   - **(c) Upgrade to a paid Langfuse plan or self-host.** Contradicts the project's stated $0/mo constraint; only worth recording as a "if we ever pay for Langfuse" revisit condition.
2. **`maintenance_role` / `BYPASSRLS` was deliberately not built** (see Design ruling above) in favor of the existing per-user GUC loop. Flag for the human because it is a legitimate alternative with different trade-offs (one bulk statement vs. N transactions) and touches `AGENTS.md`'s "stop and ask before changing security controls" — surfacing the decision rather than silently picking one.
3. **New migration adds a column + relaxes a `NOT NULL` on a table Story 4.1 owns.** Per `AGENTS.md` "Stop and ask before: changing the data model," this is flagged explicitly even though it is required by this story's own AC #1/#6 — coordinate migration ordering with whoever lands Story 4.1 first.
4. **New production secret `MAINTENANCE_TOKEN`** (Fly secret + GitHub Actions repo secret) is introduced by this story. Per `AGENTS.md` "Stop and ask before: adding a new deployment target or env var that affects production," flagging it rather than silently adding it to `fly secrets set` without sign-off.
5. **Exact Langfuse batch-delete request/response JSON shape was not directly verifiable** — the public API reference site renders client-side and this story's research tooling could not scrape the OpenAPI schema. Task 5 names the concrete verification path (`fern/apis/server/definition/trace.yml` in the `langfuse/langfuse` GitHub repo, or a scratch-project `curl` test) rather than guessing a field name that could be wrong.

### Architecture compliance (binding)

- **AD-1/AD-2 hexagonal:** `ChatRetentionPort` and `ScrubChatContentUseCase` are pure — no `drizzle-orm`, `@nestjs/*`, or `undici`/`node:fetch` imports. All I/O (Postgres, Langfuse HTTP) lives in `adapters/`. The maintenance controller is a `driving/` concern.
- **AD-3 Zod DTOs at boundaries:** `ChatMessageRowSchema` (adapter→domain) and the outbound wire DTO both change together (content nullable + `scrubbedAt`) — this is the same "one schema per boundary, not one schema for all boundaries" discipline as every other story.
- **AD-7 Mastra last:** `MaintenanceModule` is imported before `MastraModule` in `AppModule.imports`, same as every other module.
- **AD-9 ownership/RLS:** this story's entire adapter design (Task 4) exists specifically to honor "no GUC, no writes" without introducing a bypass — see Design ruling above. `chat_messages`'s existing RLS policy (from Story 4.1) is never altered, weakened, or bypassed.
- **AD-19/AD-20 deploy + health:** the maintenance route shares the exact cron infrastructure Story 1.6 built for `/healthz` keep-warm — this story does not add a scheduler, queue, or second cron mechanism, per the constitution's "no queue, no Redis, no BullMQ" rule (`project-context.md` "Quiz generation flow" section) which this story explicitly must not violate even though it's a chat-retention story, not a generation story — the same constitutional rule applies project-wide.
- **AD-N9 observability privacy:** this story is the load-bearing implementation of AD-N9's promise ("Chat message content is scrubbed after 7 days via a cron job; only metadata... retained long-term") on the Postgres side, and the best-effort (whole-trace-delete) implementation on the Langfuse side — see Open questions #1 for why "best-effort" is the honest word here.
- **Consistency Conventions — error envelope:** the 401 from the maintenance auth guard uses the exact same `{error:{code,message,requestId}}` shape as every other route (Story 1.5's `SafeExceptionFilter`), not a bespoke shape.

### Testing standards (AD-N10, NFR-4)

- Vitest; integration tests live in `apps/api/test/maintenance/` and `apps/api/test/observability/` (never colocated in `src/`).
- Coverage floors: adapters ≥60%, use-cases ≥80% (AD-N10) — this story's code is mostly adapter + one small use-case; budget accordingly.
- **No live network calls to Langfuse in CI** — mock the HTTP client for `langfuse-retention.test.ts`, consistent with Story 1.6's existing `langfuse-adapter.test.ts` approach.
- Use `supertest` against a real Nest test app for the maintenance route (auth guard, `SafeExceptionFilter` interaction) rather than unit-mocking the guard — a mocked guard proves nothing about the real 401 path.
- Run before completing: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify`.

### Anti-pattern watchlist

- ❌ Reaching for `@nestjs/schedule` "since it's right there." **Wrong for this deploy target.** Fly's free tier auto-stops the machine when idle (no `min_machines_running`), which is exactly why an external cron (`GET /healthz` every 4 min) already exists in Story 1.6 — an in-process `@Cron()` decorator never fires if the machine is asleep when the schedule would trigger, and there is no guarantee the machine is even running at the scheduled minute. The external-cron-calls-an-HTTP-route pattern is the only one compatible with auto-stop; do not "helpfully" add `@nestjs/schedule` as a belt-and-suspenders measure — it adds a dependency that cannot deliver the guarantee its presence implies.
- ❌ A run-log/`scrub_runs` table to detect "already ran this window." The predicate (`scrubbed_at IS NULL AND created_at < cutoff`) already makes every run naturally idempotent without one — adding a log table is unnecessary state to keep in sync.
- ❌ A sentinel string for tombstoned content. See "Tombstone representation" above.
- ❌ A second Postgres role / `BYPASSRLS` / second connection pool. See "Design ruling" above.
- ❌ A second GitHub Actions workflow file for the scrub cron. The AC explicitly requires reusing the *same* cron surface as `/healthz`.
- ❌ Applying `@OwnsSession()` or the `X-User-Id` middleware to the maintenance route "for consistency." This route has no session, no user identity — it is system-scoped by design.
- ❌ Writing an AC or test asserting Langfuse retains metadata after a trace delete. It does not, and this story's own research proves it — see Open questions #1.

### Project Structure Notes

New/changed files, all under the existing hexagonal tree established by Stories 1.3/1.6/4.1:

```
apps/api/
  drizzle/000X_chat-retention-scrub.sql        # NEW — content nullable + scrubbed_at column (after Story 4.1's migration)
  src/
    domain/
      ports/
        ChatRetentionPort.ts                   # NEW
        TracingPort.ts                          # UPDATE (1.6) — + deleteTracesOlderThan
        UserRepositoryPort.ts                   # UPDATE (if needed) — + listAllIds
      use-cases/
        ScrubChatContentUseCase.ts              # NEW
    adapters/
      persistence/drizzle/
        chat-retention.repo.ts                  # NEW — per-user GUC scrub loop
      observability/
        LangfuseAdapter.ts                      # UPDATE (1.6) — + deleteTracesOlderThan
        NoopTracingAdapter.ts                   # UPDATE (1.6) — + deleteTracesOlderThan no-op
    driving/
      maintenance/
        maintenance.controller.ts               # NEW — POST /api/maintenance/scrub-chat
        maintenance-auth.guard.ts               # NEW — X-Maintenance-Token constant-time check
        maintenance.module.ts                   # NEW
  test/
    maintenance/
      scrub-chat.integration.test.ts            # NEW
      tombstone-read.test.ts                    # NEW
    observability/
      langfuse-retention.test.ts                # NEW
packages/shared/src/schemas.ts                  # UPDATE — ChatMessageRowSchema + wire DTO: content nullable, + scrubbedAt
.github/workflows/keep-warm.yml                 # UPDATE (1.6) — + daily schedule entry + conditional scrub step
.env.example                                    # UPDATE — + MAINTENANCE_TOKEN (comment only)
```

Naming follows the spine's Consistency Conventions: kebab-case files, PascalCase classes, `*.port.ts` for ports, `*.repo.ts`/`*.adapter.ts` for adapters, `*.guard.ts` for guards.

### Previous story intelligence

- **Story 1.6** built `.github/workflows/keep-warm.yml`, `TracingPort`/`LangfuseAdapter`/`NoopTracingAdapter`, and explicitly left a breadcrumb: *"Note in README: this same cron is the scheduling surface Story 4.4 (7-day chat scrub) will reuse"* and *"7-day chat scrub cron | Story 4.4 | Out of scope; only mention the shared cron surface in the README."* This story is the payoff of that breadcrumb — read the actual committed `keep-warm.yml` before editing it, since the exact cron expression/step names may differ slightly from what 1.6's own story file specified.
- **Story 1.5** established the `{error:{code,message,requestId}}` envelope, the `SafeExceptionFilter`, and the "404 never 403" convention scoped specifically to session ownership — this story's 401 auth guard must render through the same filter but does not participate in the ownership convention (see AC #7's parenthetical).
- **Story 1.3** established the `SET LOCAL app.user_id` / AsyncLocalStorage GUC pattern this story's adapter reuses verbatim for a non-request (cron-triggered) code path, exactly as AD-9's "the same rule binds cron jobs and maintenance scripts: no GUC, no writes" anticipates.
- **Story 4.1** (not yet on disk at the time this story was authored — check for it before starting) owns the base `chat_messages` schema this story's migration extends. If its migration already includes a `scrubbed_at`-equivalent column or already made `content` nullable, do not duplicate — reconcile to the single definition it shipped.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.4-Chat-content-retention-7-day-scrub] — the five source ACs, carried forward verbatim
- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.1-Chat-backend-persistence--pre-submit-guard] — `chat_messages` schema this story extends (no 4.1 file exists yet on disk)
- [Source: _bmad-output/project-context.md#Security-Rules] — rule 9, "Langfuse: trace metadata only; raw chat content scrubbed via cron after 7 days"
- [Source: _bmad-output/project-context.md#Quiz-generation-flow] — "No queue, no Redis, no BullMQ" (constitution-level, project-wide, not generation-scoped)
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#NFR-3 · 10.3 Observability] — "Content scrubbing on chat after 7 days"
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#NFR-6 · 10.6 Deployment Topology] — "external cron pinging `/healthz` every 4 min to keep warm" — the shared scheduling surface
- [Source: .../ARCHITECTURE-SPINE.md#AD-9 — Ownership per request + Postgres RLS] — GUC mechanism, "cron jobs and maintenance scripts: no GUC, no writes", `users` not RLS-governed
- [Source: .../ARCHITECTURE-SPINE.md#AD-N2 — Bounded critical path + closed-world generation] — `enrich(sessionId, userId)` GUC precedent this story's adapter mirrors
- [Source: .../ARCHITECTURE-SPINE.md#AD-N9 — Observability (Langfuse + pino redaction)] — "Chat message content is scrubbed after 7 days via a cron job; only metadata... retained long-term"
- [Source: .../ARCHITECTURE-SPINE.md#AD-19 — Deploy topology] — Fly auto-stop, `max_machines_running=1`, external cron keep-warm
- [Source: .../ARCHITECTURE-SPINE.md#AD-20 — Two health endpoints] — the `/healthz` surface this story's cron entry sits alongside
- [Source: .../ARCHITECTURE-SPINE.md#Core-entity-ERD] — `chat_messages` columns
- [Source: .../ARCHITECTURE-SPINE.md#Consistency-Conventions] — error envelope, 404-never-403 (session-ownership scope only)
- [Source: _bmad-output/implementation-artifacts/1-6-observability-and-deploy-the-skeleton.md] — `keep-warm.yml`, `TracingPort`/`LangfuseAdapter`/`NoopTracingAdapter`, the explicit Story 4.4 cross-reference notes
- [Source: _bmad-output/implementation-artifacts/1-5-network-hardening-rate-limiting-cors-helmet-error-shape.md] — `SafeExceptionFilter` envelope, `@SkipThrottle()` precedent for `/healthz`
- [Source: _bmad-output/implementation-artifacts/1-3-api-skeleton-db-foundation-and-health-endpoints.md] — migration/journal sequencing caution (concurrent-story migration conflicts)
- [Source: AGENTS.md#Stop-and-ask-before] — data-model changes, new production env vars, security-control changes
- Langfuse (web-verified 2026-07, cited inline above): [Data Retention docs](https://langfuse.com/docs/administration/data-retention), [Data Deletion docs](https://langfuse.com/docs/administration/data-deletion), [Selective field-deletion discussion #8387](https://github.com/orgs/langfuse/discussions/8387), [Pricing](https://langfuse.com/pricing), [2025-01-30 retention changelog](https://langfuse.com/changelog/2025-01-30-data-retention)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
