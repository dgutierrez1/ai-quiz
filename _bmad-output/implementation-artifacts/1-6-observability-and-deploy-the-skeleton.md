# Story 1.6: Observability & deploy the skeleton

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want structured redacted logging, LLM-tracing wiring, and a reproducible deploy to Fly + Neon + Vercel,
so that the walking skeleton runs live and is debuggable without leaking secrets.

## Acceptance Criteria

_(NFR-3, NFR-6, AD-N9, AD-19, AD-20, SM-4)_

1. **Given** pino, **Then** logs redact `Authorization`, `x-api-key`, `cookie`, `x-user-id`, `req.body.*`, all `*_KEY` / `*_SECRET` env vars, and `*.apiKey`, **And** allowed fields include `requestId`, `route`, `status`, `latency_ms`, `user_id_hash` (SHA-256 of the UUID, never the raw UUID).
2. **Given** an HTTP request, **Then** exactly one structured request-completion log line is emitted carrying `requestId`, `route`, `status`, `latency_ms`, `user_id_hash` — and the `requestId` is the same value `SafeExceptionFilter` (Story 1.5) puts in the error envelope.
3. **Given** the Langfuse adapter, **Then** a `TracingPort` interface exists in `apps/api/src/domain/ports/` and `LangfuseAdapter` implements it in `apps/api/src/adapters/observability/`, **And** a test asserts a synthetic trace is emitted and flushed (assert against a mocked Langfuse client — no network call in CI).
4. **Given** Langfuse env vars are absent, **Then** the adapter degrades to a no-op and the app still boots (free-tier / local dev must not require Langfuse credentials).
5. **Given** tracing of real LLM calls, **Then** it lands with those calls in Stories 2.4 and 4.2 — **this story does not close NFR-3 / SM-5 on its own** and must not claim to.
6. **Given** the Dockerfile, **Then** it is `node:22-slim` multi-stage (**not** `node:20-slim`, **not** alpine) and the built image boots `node dist/main.js`.
7. **Given** `fly.toml`, **Then** `max_machines_running = 1`, `release_command = "node dist/main.js migrate"`, and the Fly healthcheck targets `/healthz` (timeout 30s, grace 60s, interval 30s) with auto-stop/auto-start enabled.
8. **Given** an external cron pinging `/healthz` every 4 min, **Then** the auto-stopped machine is kept warm — the cron is a committed, documented artifact (not a manual click), since Fly free tier has no `min_machines_running = 1`.
9. **Given** a deploy, **Then** the web skeleton is on Vercel, the API on Fly, the DB on Neon, **And** `/healthz` returns 200 within 30s of machine boot (SM-4).
10. **Given** `.env.example` and the README deploy section, **Then** every env var the API reads is listed with a comment, and the deploy runbook is reproducible end-to-end by a second operator.

## Tasks / Subtasks

- [ ] **Task 1 — pino logger + redaction** (AC: #1, #2)
  - [ ] Add `pino` 9.x + `nestjs-pino` (or a thin custom `LoggerService`) wired in `apps/api/src/main.ts`; replace the default Nest logger.
  - [ ] Create `apps/api/src/adapters/observability/pino-redaction.ts` exporting the redaction config: `redact: { paths: [...], censor: '[REDACTED]' }`.
  - [ ] Redaction paths (deny-list): `req.headers.authorization`, `req.headers["x-api-key"]`, `req.headers.cookie`, `req.headers["x-user-id"]`, `req.body`, `req.body.*`, `res.headers["set-cookie"]`, `*.apiKey`, `*.api_key`, `*_KEY`, `*_SECRET`.
  - [ ] Add a request-serializer that emits ONLY the allowlist: `requestId`, `route`, `method`, `status`, `latency_ms`, `user_id_hash`. Do not log the raw request/response objects.
  - [ ] `user_id_hash` = `createHash('sha256').update(xUserId).digest('hex')` — helper in the same file; never log the raw `X-User-Id`.
  - [ ] Reuse the `requestId` already generated for `SafeExceptionFilter` (Story 1.5). If Story 1.5 generated it inside the filter only, hoist it to a request-scoped value (e.g. `randomUUID()` on a middleware, stored on `req.id`) so log line and error envelope agree. **Read `safe-exception.filter.ts` before touching it and preserve its existing envelope shape `{error: {code, message, requestId}}`.**
  - [ ] `pino-pretty` in dev only; raw JSON in production.
- [ ] **Task 2 — Tracing port + Langfuse adapter** (AC: #3, #4, #5)
  - [ ] Define `apps/api/src/domain/ports/TracingPort.ts` — interface only, **zero I/O imports** (AD-2). Suggested surface: `startTrace(meta)`, `recordGeneration(traceId, meta)`, `flush(): Promise<void>`.
  - [ ] Implement `apps/api/src/adapters/observability/LangfuseAdapter.ts` against the Langfuse SDK. Metadata only in v1: `provider`, `model`, `latency_ms`, `tokens`, `cache_hit`, `session_id`, `user_id_hash`, `request_id`. **Do not send prompt/completion bodies from this story** — no LLM calls exist yet.
  - [ ] No-op fallback: if `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` are unset, register a `NoopTracingAdapter` so boot succeeds (AC #4).
  - [ ] Register via a Nest `ObservabilityModule` with a provider token (`TRACING_PORT`), imported **before** `MastraModule` in `AppModule` (AD-7: Mastra's catch-all `@All('*')` must stay last).
- [ ] **Task 3 — Dockerfile** (AC: #6)
  - [ ] `apps/api/Dockerfile`, multi-stage: builder (`node:22-slim`, `corepack enable`, `pnpm install --frozen-lockfile`, build `packages/shared` then `apps/api`) → runtime (`node:22-slim`, prod deps only, non-root user, `CMD ["node", "dist/main.js"]`).
  - [ ] Monorepo-aware: `pnpm deploy --filter @ai-quiz/api --prod` (or copy the pruned workspace) so `packages/shared` resolves at runtime.
  - [ ] `.dockerignore` excluding `node_modules`, `.git`, `_bmad*`, `**/test`, `e2e`.
  - [ ] Verify locally: `docker build` then `docker run` → `/healthz` returns 200.
- [ ] **Task 4 — fly.toml + Fly deploy** (AC: #7, #9)
  - [ ] `apps/api/fly.toml`: `[build] dockerfile`, `[deploy] release_command = "node dist/main.js migrate"`, `[http_service]` with `internal_port = 4000`, `auto_stop_machines = true`, `auto_start_machines = true`, `min_machines_running = 0`, **`max_machines_running = 1`**.
  - [ ] `[[http_service.http_checks]]` → `path = "/healthz"`, `interval = "30s"`, `timeout = "30s"`, `grace_period = "60s"`.
  - [ ] Set secrets via `fly secrets set` (never commit): `DATABASE_URL`, `MINIMAX_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `WEB_ORIGIN`.
  - [ ] ⚠️ `max_machines_running = 1` is read at boot by Story 1.5's machine-count guard — a value ≠ 1 must refuse to start. Do not weaken either side.
- [ ] **Task 5 — Neon + Vercel** (AC: #9)
  - [ ] Neon free-tier project; `DATABASE_URL` with `?sslmode=require`; confirm `release_command` migration applies on first deploy.
  - [ ] Vercel project rooted at `apps/web`; set `NEXT_PUBLIC_API_URL` to the Fly URL; deploy the Next.js skeleton.
  - [ ] Confirm CORS end-to-end: set `WEB_ORIGIN` on Fly to the production Vercel origin (exact match — `WEB_ORIGIN_REGEX` is ignored when `NODE_ENV=production`, AD-N8).
- [ ] **Task 6 — Keep-warm cron** (AC: #8)
  - [ ] Commit a scheduled `GET /healthz` every 4 minutes. Preferred: `.github/workflows/keep-warm.yml` with `on: schedule: cron: "*/4 * * * *"` and a `curl -fsS $API_URL/healthz`. Document the alternative (external uptime pinger) in the README.
  - [ ] The workflow must not fail the repo's status checks on a cold-start timeout — retry once before failing.
  - [ ] Note in README: this same cron is the scheduling surface Story 4.4 (7-day chat scrub) will reuse.
- [ ] **Task 7 — Env + docs** (AC: #10)
  - [ ] `.env.example` at repo root, matching architecture-spec §A.10 exactly (DB, LLM defaults, MiniMax/OpenRouter keys, Tavily, Langfuse, `WEB_ORIGIN`/`WEB_ORIGIN_REGEX`, `API_PORT`, `RATE_LIMIT_TTL`/`RATE_LIMIT_MAX`). **Do not add `USER_HMAC_SECRET`** (removed) or Groq/OpenAI/Anthropic/Ollama keys (v2).
  - [ ] README deploy section: Fly + Neon + Vercel runbook, secret list, migration behavior, keep-warm cron, cold-start expectation (SM-C2: >30s cold acceptable, <5s warm).
- [ ] **Task 8 — Tests** (AC: #1, #2, #3, #4)
  - [ ] `apps/api/test/observability/pino-redaction.test.ts` — assert each deny-listed path is censored and each allowlisted field survives; assert `user_id_hash` ≠ raw UUID and is 64 hex chars.
  - [ ] `apps/api/test/observability/langfuse-adapter.test.ts` — mocked SDK; assert a synthetic trace is emitted with expected metadata and `flush()` is awaited (AC #3).
  - [ ] `apps/api/test/observability/tracing-noop.test.ts` — with Langfuse env unset, module resolves to the no-op and boot succeeds (AC #4).
  - [ ] Integration: hit a route, assert exactly one completion log line with the allowlist fields and no raw `x-user-id` anywhere in the serialized output.
  - [ ] Run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test` and `pnpm verify` before marking done.

## Dev Notes

### What this story owns vs. what it must not touch

| Concern                                                   | Owner                         | Note for this story                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/healthz` + `/api/health` endpoints                      | **Story 1.3** (already built) | Do **not** re-implement. This story only _points_ Fly's healthcheck and the cron at `/healthz`. AD-N9's "`/api/health` also reports rate-limiter + memory health" is a small extension you may add to the existing controller — do not rewrite it. |
| Drizzle `migrate` CLI entry (`node dist/main.js migrate`) | **Story 1.3**                 | This story wires it as `release_command`. If the entry does not exist, that is a 1.3 gap — surface it, don't silently invent a second migration path.                                                                                              |
| `SafeExceptionFilter` + `requestId`                       | **Story 1.5**                 | Read it first. Reuse its `requestId`; do not fork a second id scheme.                                                                                                                                                                              |
| `max_machines_running` boot guard                         | **Story 1.5**                 | This story supplies the `fly.toml` value the guard reads. Keep them consistent (= 1).                                                                                                                                                              |
| Real LLM-call tracing                                     | **Stories 2.4, 4.2**          | Out of scope. AC #5 exists to stop this story from over-claiming NFR-3/SM-5.                                                                                                                                                                       |
| 7-day chat scrub cron                                     | **Story 4.4**                 | Out of scope; only mention the shared cron surface in the README.                                                                                                                                                                                  |

### Architecture constraints (non-negotiable)

- **AD-2 domain purity**: `TracingPort.ts` lives in `domain/ports/` and must import nothing from `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, `node:fetch`, or the Langfuse SDK. ESLint `no-restricted-imports` (Story 1.1) will fail the build otherwise.
- **AD-7 Mastra last**: `MastraModule.register({mastra})` ships a catch-all `@All('*')`. Any new module (including `ObservabilityModule`) must be imported **before** it in `AppModule.imports`.
- **AD-19 base image**: `node:22-slim`. The SPEC archive and the pre-audit spine say `node:20-slim` — that is **wrong and build-breaking** (Mastra requires Node `>= 22.13.0` and our `engines` pin is `>= 22.22.1`; the check fails either way). Do not copy from the archive.
- **AD-19 `max_machines_running = 1`**: required, not incidental — the in-memory throttler (AD-N7) is only correct on one machine.
- **AD-N9 privacy**: Langfuse gets trace _metadata_ only. pino gets the allowlist only. `x-user-id` is redacted in logs and appears in traces only as `user_id_hash`.
- **AD-18 lazy SDK**: don't eagerly import provider SDKs anywhere you touch — the Fly free tier is a 256 MB machine.
- **`@ai-quiz/no-console-log` lint rule** (Story 1.1) forbids `console.log` outside `apps/api/src/adapters/`. Use the pino logger.

### Library versions (from the verified stack table, 2026-07-19)

| Package      | Version          | Note                                                                                            |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------------- |
| Node         | **`>= 22.22.1`** | pinned in `engines`; Docker base `node:22-slim`                                                 |
| pino         | 9.x              | `pino-pretty` dev-only                                                                          |
| Langfuse SDK | latest           | v3 JS SDK; **must `await flush()`** — the process can auto-stop on Fly and drop buffered events |
| NestJS       | 11.1.28          | `@nestjs/platform-express` only                                                                 |
| Vitest       | 4.1.10           | test runner for all AC #8 tests                                                                 |
| pnpm         | 9.x workspaces   | Docker build must be workspace-aware                                                            |

### Failure modes to avoid

- **Logging the raw `X-User-Id`.** It is the identity token; it is deny-listed for a reason. Hash it.
- **`redact` paths that don't match nested serializer output.** pino redaction operates on the _serialized_ object shape — write the test first and confirm the censor actually fires; a silently non-matching path looks identical to a working one.
- **Blocking boot on Langfuse.** Free tier + local dev have no keys. No-op fallback is mandatory (AC #4).
- **Not flushing traces.** Fly auto-stops the machine; unflushed Langfuse events vanish. This is why AC #3 asserts flush, not just emit.
- **Committing secrets.** `fly secrets set` + Vercel env only. `.env.example` carries names and comments, never values.
- **Alpine base image.** Native module build headaches; the spec explicitly rejects it.

### Project Structure Notes

New files (all NEW — no existing implementation code in the repo yet):

```
apps/api/
  src/
    domain/ports/TracingPort.ts                  # interface only, pure
    adapters/observability/
      pino-redaction.ts                          # redact config + user_id_hash helper
      LangfuseAdapter.ts                         # implements TracingPort
      NoopTracingAdapter.ts                      # env-absent fallback
      observability.module.ts                    # Nest module, TRACING_PORT token
  test/observability/
    pino-redaction.test.ts
    langfuse-adapter.test.ts
    tracing-noop.test.ts
  Dockerfile                                     # node:22-slim multi-stage
  fly.toml                                       # max_machines_running=1, release_command
.dockerignore
.env.example                                     # per architecture-spec §A.10
.github/workflows/keep-warm.yml                  # */4 * * * * → GET /healthz
README.md                                        # deploy runbook section
```

Modified: `apps/api/src/main.ts` (pino logger), `apps/api/src/app.module.ts` (import `ObservabilityModule` before `MastraModule`), optionally `driving/health/` (AD-N9 `/api/health` extension).

Naming follows the Consistency Conventions: kebab-case files for helpers/modules, PascalCase for adapter/port classes, `*.port.ts` / `*.adapter.ts` suffixes where the spine's source tree uses them.

### Previous story intelligence

None available — this is the first story file created for the project and no implementation code exists yet (`apps/`, `packages/` are unscaffolded per AGENTS.md "Current state"). Stories 1.1–1.5 are being authored concurrently; **read whatever 1.1/1.3/1.5 artifacts exist at dev time before starting**, since this story depends on their `main.ts`, `app.module.ts`, health endpoints, migrate CLI, and `SafeExceptionFilter`.

### Dependencies

**Blocked by:** 1.1 (monorepo + lint + tsconfig), 1.3 (NestJS app, `/healthz`, `/api/health`, migrate CLI, Drizzle/Neon), 1.5 (`SafeExceptionFilter` + `requestId`, machine-count guard).
**Unblocks:** Epic 1 exit criterion (walking skeleton live); Story 4.4 reuses the cron surface; Stories 2.4/4.2 consume `TracingPort`.

### Testing standards

- Vitest for all tests here; place under `apps/api/test/observability/`.
- Adapter coverage floor is ≥60% (AD-N10) — the redaction config and the flush path are the parts that must be covered.
- No network calls in CI: mock the Langfuse client.
- Gate before completion: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test && pnpm --filter @ai-quiz/web test:e2e`, then `pnpm verify`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6: Observability & deploy the skeleton]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-N9 — Observability (Langfuse + pino redaction)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-19 — Deploy topology]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-20 — Two health endpoints]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-7 — Mastra catch-all MUST be last]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-18 — Lazy SDK loading]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#Stack]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#Minimal source tree]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#Deployment topology]
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#NFR-3 · 10.3 Observability]
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#NFR-6 · 10.6 Deployment Topology]
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#Success Metrics] — SM-4, SM-5, SM-C2
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.10 Environment]
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.13 Build Order] — steps 11 and 16
- [Source: _bmad-output/project-context.md#Observability privacy] — constitution rule 9
- [Source: _bmad-output/planning-artifacts/implementation-readiness-report-2026-07-19-run5.md#C-2] — why AC #3 is a testable synthetic-trace assertion and AC #5 exists

## Open Questions

1. **Cron host is unspecified.** The PRD/spine say "external cron" without naming a mechanism. GitHub Actions `schedule` is chosen here because it is free, committed, and reusable by Story 4.4 — but GH Actions cron is best-effort and can skew several minutes past a 4-minute interval, which partially undercuts the keep-warm intent. If cold starts prove disruptive in Epic 5, swap to a dedicated uptime pinger.
2. **`/api/health` provider reachability.** AD-20/AD-N9 say `/api/health` deep-checks _DB + provider reachability_, but no provider adapter exists until Story 2.3. The provider half of that check is unimplementable in Epic 1 — treat it as landing with 2.3, not here.
3. **`requestId` ownership is split.** Story 1.5 owns `SafeExceptionFilter`'s `requestId`; this story needs the same value on the success path. If 1.5 scoped it to the filter, one of the two stories must hoist it. Flagged so the dev agent doesn't create two ids.
4. **SM-4's "200 within 30s of boot" has no automated assertion.** It is a manual post-deploy verification in this story. No CI job can assert it (deployment automation is explicitly deferred to v2). Recorded as a runbook step, not a test.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
