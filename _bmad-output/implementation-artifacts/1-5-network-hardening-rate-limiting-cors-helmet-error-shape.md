# Story 1.5: Network hardening (rate limiting, CORS, helmet, error shape)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want every route rate-limited and hardened against cross-origin and malformed input,
so that the single-machine deployment resists abuse and leaks no internals.

## Acceptance Criteria

_(NFR-1, NFR-2, AD-N7, AD-N8, AD-19)_

1. **Double-keyed rate limiting.** Every route is limited **twice** — once keyed by `X-User-Id`, once keyed by source IP — against the same limit table, stricter wins: Global **30/min**, `POST /api/sessions` **5/min**, `POST /api/sessions/:id/chat` **20/min**.
2. **429 shape.** Exceeding either key returns **429** with a `Retry-After` header (seconds) and the standard error envelope.
3. **Guard ordering.** The throttler guards run **after** `user-id.middleware.ts` (format check) and **before** `identity.interceptor.ts` (DB + transaction) — a malformed-UUID or unauthenticated flood is throttled without ever opening a Postgres transaction (AD-9 step 1b).
4. **CORS.** Exact `WEB_ORIGIN` is **always** allowed. `WEB_ORIGIN_REGEX` is honored **only when `NODE_ENV !== 'production'`**. Methods `GET, POST`; allowed headers `Content-Type, X-User-Id`; `maxAge: 600`. `X-User-Hmac` is **not** in the contract.
5. **Helmet.** A custom CSP appropriate to a JSON-only API and HSTS with `maxAge` = 2 years (`63072000`), `includeSubDomains`, `preload`.
6. **Body limits.** JSON and urlencoded bodies larger than **100 KB** are rejected (413) and surface through the error envelope, not a raw Express error page.
7. **Error shape.** `SafeExceptionFilter` returns `{error: {code, message, requestId}}` for every failure, with **no stack trace, no `cause`, no internal path** in the response body. Existing status semantics from Story 1.4 are preserved exactly: malformed `X-User-Id` → **400**, cross-user/not-found session → **404** (never 403), and unknown errors → **500** with a generic message.
8. **Single-machine boot guard.** A boot-time guard verifies the deployed `max_machines_running` is exactly **1** and refuses to start otherwise (in-memory counters silently multiply every limit by N machines). A test asserts the guard throws on a value of `2` and passes on `1`.
9. **Tests.** Vitest security tests in `apps/api/test/security/` cover: per-user limit trip, per-IP limit trip, stricter-wins on `POST /api/sessions`, `Retry-After` presence, CORS prod vs non-prod regex behavior, helmet headers present, 413 on a >100 KB body, error-envelope shape with no stack, and the boot guard at `1` and `2`.

## Tasks / Subtasks

- [ ] **Task 1 — Throttler configuration module** (AC: #1, #2)
  - [ ] Create `apps/api/src/driving/middleware/throttler.config.ts` exporting the **single source of truth** limit table: `GLOBAL = {ttl: 60_000, limit: 30}`, `CREATE_SESSION = {ttl: 60_000, limit: 5}`, `CHAT = {ttl: 60_000, limit: 20}`. `ttl` is **milliseconds** in `@nestjs/throttler` v6 (it was seconds in v4 — do not copy v4 snippets).
  - [ ] Register `ThrottlerModule.forRoot([{name: 'global', ...GLOBAL}])` in `AppModule`. `AppModule.imports` order is unchanged in one respect: **`MastraModule.register()` must remain LAST** (AD-7) — add the throttler import above it.
  - [ ] Export a `@ThrottleCreateSession()` and `@ThrottleChat()` decorator wrapping `@Throttle({global: {...}})` so route files never restate numbers.
  - [ ] Apply `@ThrottleCreateSession()` to the Story 1.4 stub `POST /api/sessions`. The chat decorator is **declared now, applied in Story 4.1** when the route exists — do not create a chat route here.
- [ ] **Task 2 — Two guards, two keys** (AC: #1, #3)
  - [ ] `apps/api/src/driving/middleware/user-throttler.guard.ts` — extends `ThrottlerGuard`; override `getTracker(req)` to return the `X-User-Id` header; override `generateKey(context, suffix, name)` to prefix the key (e.g. `user:`).
  - [ ] `apps/api/src/driving/middleware/ip-throttler.guard.ts` — extends `ThrottlerGuard`; keeps the default IP tracker; override `generateKey` with an `ip:` prefix.
  - [ ] ⚠️ **Both guards MUST use distinct key prefixes.** They share the same storage and the same throttler name; without prefixes the two keys collide into one counter and the double-keying silently becomes single-keying.
  - [ ] Register both as `APP_GUARD` providers in `AppModule`. Guards run after middleware and before interceptors — this is what satisfies AC #3; do **not** convert either to middleware or an interceptor.
  - [ ] "Stricter wins" is **emergent, not coded**: both guards must pass, so the lower effective budget rejects first. Do not write comparison logic.
  - [ ] In `UserThrottlerGuard.getTracker`, when `X-User-Id` is absent (unauthenticated routes), fall back to the IP tracker rather than a constant — a constant key would pool every anonymous caller into one shared 30/min bucket and let one client DoS all others.
  - [ ] Confirm `Retry-After` is present on the 429 (throttler v6 sets it); if the version in the lockfile does not, set it in `throwThrottlingException`.
- [ ] **Task 3 — Exempt the liveness endpoint** (AC: #1)
  - [ ] Apply `@SkipThrottle()` to `GET /healthz`. Fly's healthcheck (every 30 s) plus the AD-19 keep-warm cron (every 4 min) hit this route from the platform's own address range; a throttled `/healthz` risks a **429 → failed healthcheck → machine kill-loop**. `/api/health` stays throttled (it is not in the public path per AD-N9).
- [ ] **Task 4 — CORS** (AC: #4)
  - [ ] In `main.ts`, `app.enableCors({...})` with an `origin` callback: allow when `origin === process.env.WEB_ORIGIN`; additionally allow when `process.env.NODE_ENV !== 'production'` **and** the origin matches `new RegExp(process.env.WEB_ORIGIN_REGEX)`; otherwise deny.
  - [ ] `methods: ['GET', 'POST']`, `allowedHeaders: ['Content-Type', 'X-User-Id']`, `maxAge: 600`.
  - [ ] Requests with **no** `Origin` header (curl, server-to-server, Fly healthcheck) must be allowed — CORS is a browser control and blocking them breaks the healthcheck.
  - [ ] Build the regex **once at bootstrap**, not per request, and guard `WEB_ORIGIN_REGEX` being unset (skip the branch rather than constructing `new RegExp(undefined)`).
- [ ] **Task 5 — Helmet + body limits** (AC: #5, #6)
  - [ ] `app.use(helmet({...}))` with a JSON-API CSP — `default-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'` — and `hsts: {maxAge: 63072000, includeSubDomains: true, preload: true}`. The API serves no HTML; do **not** copy a web-app CSP that permits `'unsafe-inline'` scripts.
  - [ ] Create the Nest app with `{bodyParser: false}` and register `express.json({limit: '100kb'})` + `express.urlencoded({limit: '100kb', extended: true})` explicitly — Nest's default parser has no limit and silently wins if you leave it enabled.
  - [ ] Verify the resulting `PayloadTooLargeError` (413) is caught by `SafeExceptionFilter` and rendered as the envelope (AC #7), not as Express's default HTML error page.
- [ ] **Task 6 — `SafeExceptionFilter`** (AC: #7)
  - [ ] `apps/api/src/driving/middleware/safe-exception.filter.ts`, `@Catch()` (all exceptions), registered globally via `APP_FILTER`.
  - [ ] Mapping: `HttpException` → its own status; `code` from a stable machine string (e.g. `BAD_REQUEST`, `NOT_FOUND`, `TOO_MANY_REQUESTS`, `PAYLOAD_TOO_LARGE`); everything else → **500** `INTERNAL_ERROR` with a fixed generic message.
  - [ ] ⚠️ **Preserve Story 1.4's status semantics.** The filter must not rewrite 400 (malformed UUID) or 404 (`NotFoundError`, cross-user existence-leak prevention) into 500 or 403. Add a regression test for each.
  - [ ] `requestId`: generate with `crypto.randomUUID()` per request if absent. Story 1.6 wires pino/`pino-http` — leave a comment that 1.6 must reuse **this same** id (`req.id`) rather than minting a second one, or logs and responses become uncorrelatable.
  - [ ] Log the full error (message + stack) **server-side** at `error` level; only the sanitized envelope crosses the wire. Never echo `exception.message` from a non-`HttpException` — it can carry a DSN, SQL fragment, or file path.
  - [ ] Do not swallow the exception: the Story 1.4 `identity.interceptor.ts` owns transaction rollback and needs the error to have propagated to it first. The filter is the last stage — verify a thrown use-case error still rolls back its transaction.
- [ ] **Task 7 — Single-machine boot guard** (AC: #8)
  - [ ] Pure, exported, testable function in `apps/api/src/driving/middleware/single-machine.guard.ts`: `assertSingleMachine(env: {FLY_APP_NAME?: string; MAX_MACHINES_RUNNING?: string}): void`.
  - [ ] Behavior: when `FLY_APP_NAME` is set (i.e. running on Fly), `MAX_MACHINES_RUNNING` **must** be exactly `'1'` — anything else (including unset) throws and the process exits non-zero. Off-Fly (local dev, CI) the check is skipped with a debug log, so tests and `docker compose` are unaffected.
  - [ ] Call it in `main.ts` **before** `app.listen()`.
  - [ ] `MAX_MACHINES_RUNNING` is supplied from the `[env]` block of `fly.toml`, mirroring the literal `max_machines_running` value. **Story 1.6 owns `fly.toml`** — add both the `[env]` entry and a note there that the two values must be edited together. Add `MAX_MACHINES_RUNNING=1` to `.env.example` with a comment.
  - [ ] Test asserts: `'1'` + `FLY_APP_NAME` → passes; `'2'` → throws; unset + `FLY_APP_NAME` → throws; no `FLY_APP_NAME` → passes.
- [ ] **Task 8 — Security test suite** (AC: #9)
  - [ ] `apps/api/test/security/rate-limit.test.ts` — 31st request in a window → 429 + `Retry-After`; 6th `POST /api/sessions` → 429 (stricter route limit beats the global 30); two different `X-User-Id` values from the **same** IP still trip the IP key; two different IPs with the **same** `X-User-Id` still trip the user key.
  - [ ] Reset throttler storage between tests (fresh Nest app per describe block, or clear the `ThrottlerStorageService` map) — leaked counters make these tests order-dependent and flaky.
  - [ ] `cors.test.ts` — with `NODE_ENV=production`, a preview origin matching `WEB_ORIGIN_REGEX` is **denied** while exact `WEB_ORIGIN` is allowed; with `NODE_ENV=test`, the regex origin is allowed.
  - [ ] `helmet.test.ts` — `Content-Security-Policy` and `Strict-Transport-Security` (with `max-age=63072000; includeSubDomains; preload`) present on a real response.
  - [ ] `body-limit.test.ts` — a >100 KB JSON body → 413 in envelope shape.
  - [ ] `error-shape.test.ts` — response body has exactly `error.code`, `error.message`, `error.requestId`; **no** `stack`, `stacktrace`, or `trace` key anywhere in the JSON; 400/404 regressions from Story 1.4 still return their original statuses.
  - [ ] `single-machine.test.ts` — the four cases from Task 7.
  - [ ] Run the gate: `pnpm --filter @ai-quiz/api test` then `pnpm verify`.

## Dev Notes

### What this story is

The **driving-layer hardening pass**. It adds no domain logic, no use-cases, no ports, no adapters, and no DB tables. Everything lands in `apps/api/src/driving/middleware/` plus `main.ts` and `app.module.ts`. Nothing here may import from `apps/api/src/domain/` internals (AD-1/AD-2).

### Files being modified (from Stories 1.3 / 1.4 — read before editing)

| File                                                      | State            | This story changes                                                                                         |
| --------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/api/src/main.ts`                                    | UPDATE (1.3)     | add helmet, CORS, explicit body parsers, boot guard; app created with `{bodyParser: false}`                |
| `apps/api/src/app.module.ts`                              | UPDATE (1.3/1.4) | add `ThrottlerModule`, two `APP_GUARD`s, one `APP_FILTER`. **`MastraModule.register()` stays last** (AD-7) |
| `apps/api/src/driving/sessions/*`                         | UPDATE (1.4)     | add `@ThrottleCreateSession()` to the `POST /api/sessions` stub                                            |
| `apps/api/src/driving/health/*`                           | UPDATE (1.3)     | add `@SkipThrottle()` to `/healthz` only                                                                   |
| `apps/api/src/driving/middleware/user-id.middleware.ts`   | READ ONLY (1.4)  | must keep running **before** the guards — do not touch                                                     |
| `apps/api/src/driving/middleware/identity.interceptor.ts` | READ ONLY (1.4)  | must keep running **after** the guards — do not touch                                                      |
| `.env.example`                                            | UPDATE (1.1/1.3) | add `MAX_MACHINES_RUNNING=1`                                                                               |

**Must not break:** the Story 1.4 four-layer ownership chain (400 on malformed UUID → guard → identity interceptor `SET LOCAL app.user_id` via AsyncLocalStorage → `findByIdAndUserId` → 404 → RLS). Re-run `apps/api/test/security/ownership.test.ts` after wiring the global filter — a filter that re-maps statuses is the single most likely regression in this story.

### Non-negotiable ordering (AD-9 step 1b)

NestJS executes **middleware → guards → interceptors → handler**. That order is the whole reason the throttler is a **guard**:

- `user-id.middleware` (1a) rejects malformed UUIDs with zero DB cost.
- Throttler **guards** (1b) reject floods before any transaction opens.
- `identity.interceptor` (1c) upserts `users`, opens the transaction, sets the GUC.

Making the throttler middleware or an interceptor breaks this: as an interceptor it would run _after_ the transaction opened, and every throttled flood would still hit Postgres.

### Rate-limit table (AD-N7 — do not restate numbers in route files)

| Endpoint                      | Per-user | Per-IP |
| ----------------------------- | -------- | ------ |
| Global                        | 30/min   | 30/min |
| `POST /api/sessions`          | 5/min    | 5/min  |
| `POST /api/sessions/:id/chat` | 20/min   | 20/min |

- **The IP key is the real control** — `X-User-Id` is browser-generated, forgeable, and rotatable.
- **Do not add an IP-only fallback looser than the per-user limit.** The removed "5 req/**sec**/IP" rule was 300/min against a 30/min per-user limit and handed a UUID-rotating attacker a 10× budget increase. It is deleted; do not reintroduce it.
- **Do not reintroduce HMAC binding** (`X-User-Hmac`, `USER_HMAC_SECRET`). AD-11 was deleted outright — the browser had to compute the HMAC, so the secret shipped client-side and forging was free. `X-User-Hmac` must **not** appear in the CORS allowed-headers list.
- **In-memory store is the accepted v1 choice** — do not add Redis/Upstash. Its correctness is entirely purchased by `max_machines_running = 1`, which is why AC #8 exists.

### The boot guard (AC #8) — how to actually read the value

The epic phrases this as "reads the deployed `max_machines_running`". There is no runtime API for that without a Fly API token, so the implementable form is an **env mirror**: `fly.toml` sets `MAX_MACHINES_RUNNING = "1"` in its `[env]` block alongside the literal `max_machines_running = 1`, and the guard asserts the env value. Keep the guard a pure function over an env object so it is trivially testable and so the Fly-side wiring can land in Story 1.6 without changing this code. See Open Questions.

### CORS (AD-N8)

Exact `WEB_ORIGIN` always; `WEB_ORIGIN_REGEX` (e.g. `^https://.*\.vercel\.app$`) **only** when `NODE_ENV !== 'production'`.

⚠️ **Do not implement the `x-vercel-environment: production` gate** described in the frozen SPEC archive. That header exists inside Vercel's runtime and is never present on a cross-origin browser request to Fly — the check cannot function. It was removed by the 2026-07-16 audit.

### Error envelope (Consistency Conventions)

`{error: {code, message, requestId}}` on every failure. Companion conventions already fixed elsewhere and inherited here: **404, never 403**, for cross-user access; **429 with `Retry-After`**; `400 DOC_TOO_LARGE` with a `hint` field for the Epic-2 size guard — so the filter must tolerate an optional extra field on the error object rather than stripping unknown keys.

### Testing standards (AD-N10, NFR-4)

- Vitest; security tests live in `apps/api/test/security/`.
- Coverage floors enforced by `pnpm verify`: adapters ≥60%, use-cases ≥80%. This story's code is driving-layer; hold it to the adapter floor at minimum and prefer full-path integration tests over unit mocks (a mocked throttler proves nothing about guard ordering).
- Use `supertest` against a real Nest test app so helmet/CORS/body-parser/filter all execute in the real pipeline.
- No Playwright work in this story.
- `pnpm verify` = `lint:check && typecheck && test && test:e2e && build` is the gate.

### Anti-patterns to avoid

- Re-implementing rate limiting by hand — `@nestjs/throttler` v6 is the mandated library.
- Writing "stricter wins" comparison logic — two guards both passing gives it for free.
- One guard with branching key logic — you cannot key twice from a single `getTracker`.
- Omitting the key prefix — collapses two counters into one.
- Enabling Nest's default body parser alongside an explicit one.
- Returning `exception.message` for unknown errors.
- Throttling `/healthz`.

### Project Structure Notes

New files (all under the existing 1.3 skeleton, no new top-level dirs):

```
apps/api/src/driving/middleware/
  throttler.config.ts          # limit table + @Throttle decorators (single source of truth)
  user-throttler.guard.ts      # AD-N7 — X-User-Id key, `user:` prefix
  ip-throttler.guard.ts        # AD-N7 — IP key, `ip:` prefix
  safe-exception.filter.ts     # AD-N8 error envelope, no stack traces
  single-machine.guard.ts      # AD-19 boot guard (pure fn)
apps/api/test/security/
  rate-limit.test.ts  cors.test.ts  helmet.test.ts
  body-limit.test.ts  error-shape.test.ts  single-machine.test.ts
```

Conventions: kebab-case filenames, PascalCase classes, `*.guard.ts` / `*.filter.ts` suffixes. `@ai-quiz/no-console-log` applies outside `apps/api/src/adapters/` — use the Nest `Logger` (pino replaces it in 1.6), not `console.log`, in the filter and boot guard.

**Cross-story seams:**

- `POST /api/sessions/:id/chat` (20/min) — decorator declared here, applied in **Story 4.1**.
- `fly.toml` + `MAX_MACHINES_RUNNING` env wiring — **Story 1.6**.
- pino `requestId` correlation with this filter's id — **Story 1.6**.
- Cross-user isolation E2E over the hardened stack — **Story 5.3**.

### Library / version pins (from the spine Stack table, verified 2026-07-19)

| Package                           | Version          | Note                                                                                         |
| --------------------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `@nestjs/throttler`               | **6.x**          | `ttl` is **milliseconds** in v6; v4-era snippets use seconds and will produce a 60 ms window |
| `@nestjs/core` / `@nestjs/common` | 11.1.28          | NestJS **11**, not 10                                                                        |
| `@nestjs/platform-express`        | 11.1.28          | Express only — Fastify is forbidden (AD-8); `helmet`/`express.json` usage assumes Express    |
| `helmet`                          | current 8.x      | `app.use(helmet({...}))`                                                                     |
| Node                              | **`>= 22.22.1`** | `crypto.randomUUID()` is global — no import needed                                           |
| Vitest                            | 4.1.10           |                                                                                              |
| Zod                               | 4.4.3            |                                                                                              |

### Previous story context

No implementation-artifact story files exist yet and the repo contains no source code — Stories 1.1–1.4 are specified but not yet written, so there are no prior dev notes, review findings, or commit patterns to inherit. Treat the file table above as the contract with 1.3/1.4 and re-read those files as they actually exist before editing. If 1.4's `identity.interceptor.ts` diverges from the AD-9 description, follow the code and flag the divergence rather than silently reshaping it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5: Network hardening (rate limiting, CORS, helmet, error shape)] — the ACs
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-N7] — double-keyed rate limits, v4 UUID regex, limit table, in-memory store constraint
- [Source: .../ARCHITECTURE-SPINE.md#AD-N8] — CORS `NODE_ENV` gate, methods/headers/maxAge, no `X-User-Hmac`
- [Source: .../ARCHITECTURE-SPINE.md#AD-9] — middleware → guard → interceptor ordering (step 1a/1b/1c)
- [Source: .../ARCHITECTURE-SPINE.md#AD-19] — `max_machines_running = 1` required; deploy topology
- [Source: .../ARCHITECTURE-SPINE.md#AD-7] — `MastraModule.register()` must be last in `AppModule.imports`
- [Source: .../ARCHITECTURE-SPINE.md#Consistency Conventions] — `{error: {code, message, requestId}}`, 404-not-403, 429 + `Retry-After`, lint/format/TS rules
- [Source: .../ARCHITECTURE-SPINE.md#AD-N10] — Vitest security-suite location, coverage floors, CI run order
- [Source: .../ARCHITECTURE-SPINE.md#Stack] — version pins
- [Source: .../ARCHITECTURE-SPINE.md#Minimal source tree] — `driving/middleware/` file names
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#NFR-2 · 10.2 Rate Limiting] — per-user/per-IP table, removed 5-req/sec fallback, in-memory acceptance
- [Source: prd.md#NFR-1 · 10.1] — CORS rule, removed HMAC binding, removed `x-vercel-environment` gate
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.10 Environment] — `WEB_ORIGIN`, `WEB_ORIGIN_REGEX`, `RATE_LIMIT_TTL`, `RATE_LIMIT_MAX`
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.13 Build Order step 9] — driving layer: throttler, helmet, CORS, body limits, `SafeExceptionFilter`
- [Source: _bmad-output/project-context.md#Security Rules 6, 7] — identity spoofing mitigation, NestJS hardening
- [Source: _bmad-output/planning-artifacts/implementation-readiness-report-2026-07-19-run5.md:547] — the finding that upgraded AC #8 from a doc comment to an enforced boot guard

### Open Questions / Spec Gaps

1. **`max_machines_running` is not runtime-readable.** The AC says the guard "reads the deployed `max_machines_running`"; Fly exposes no such env var, so this story implements an **env mirror** (`MAX_MACHINES_RUNNING` in `fly.toml`'s `[env]`) that a human must keep in sync with the literal. A stronger option — a CI check that parses `fly.toml` and asserts both values agree — belongs with `fly.toml` in Story 1.6. Flag for the operator if the mirror is considered too weak.
2. **`RATE_LIMIT_TTL` / `RATE_LIMIT_MAX` env vars** exist in `architecture-spec.md` §A.10 but the AD-N7 table is a fixed per-route matrix. This story treats the code table as authoritative and the env vars as unused legacy; if they must be honored they can only parameterize the global tier, not the per-route ones.
3. **Trusted proxy / IP resolution.** No artifact states whether Express `trust proxy` should be enabled behind Fly's edge. If it is not set, the per-IP key may collapse to the proxy address and every user shares one bucket; if it is set naively, `X-Forwarded-For` becomes client-spoofable and the IP key — described as "the real control" — is defeated. Recommended resolution: enable `trust proxy` with a hop count of 1 on Fly and verify against a real deploy in Story 1.6.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
