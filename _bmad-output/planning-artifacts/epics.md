---
stepsCompleted: ["step-01", "step-02", "step-03", "step-04"]
updated: 2026-07-19
revisions:
  - "2026-07-19 — step-04 final validation: 6 checks passed; fixed 2 split-induced forward deps in Story 2.4 (critical-path AC and shortfall ladder claimed steps owned by 2.5/2.6) + 5 remaining untokenised breakpoint ACs"
  - "2026-07-19 — readiness run 5 fixes: AD-N4 feasibility rule corrected (was refuted); Story 2.4 split into 2.4/2.5/2.6; Epic 2 seam declared; Langfuse + scrub + README + breakpoint stories added"
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/specs/architecture-spec.md
  - _bmad-output/project-context.md
---

# AI Quiz Agent - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the AI Quiz Agent (ai-quiz), decomposing the requirements from the PRD, Architecture Spine, and the implementation reference into implementable stories. No UX design contract exists; UI requirements are carried inline in FR-5 / FR-10 and NFR-5.

## Requirements Inventory

### Functional Requirements

> 15 active FRs. FR-12 and FR-13 were removed 2026-07-19 (gap analysis delivered via chat, FR-10).

- **FR-1: SSRF-safe markdown ingest** — fetch arbitrary user-supplied Markdown URLs without exposing internal networks (scheme allowlist, expanded IP blocklist, DNS-pin-then-validate, IDN homograph rejection, HTTP/0.9 rejection, tiered size limits, 10s timeout, redirects off). *[AD-10]*
- **FR-2: Strategy (user-picked) + question pool with stratified category selection** — `strategy` required in `POST /sessions` (enum: factual|comprehension|mixed|trivia; no LLM proposal, no silent default); one LLM call returns a pool of `ceil(questionCount × 1.5)` category-tagged questions; the pool is validated, then the system selects a feasible category count (preferring 4–6, else any feasible `C` in `[2, min(8,m)]` per AD-N4) and **stratified-samples** the quiz evenly across them (count per category differs by ≤1). Redesigned 2026-07-19 — supersedes the category-pool design, which required two LLM calls and contradicted FR-16. *[AD-N4]*
- **FR-3: LLM question generation (structured, single call)** — one structured-output call generates a **pool** of `ceil(questionCount × 1.5)` questions, 4 answers each, type ∈ {single, multiple}; single requires exactly 1 correct, multiple requires 2–4; every pool question carries a model-derived `category` tag. The model is **not** asked to allocate questions across categories — even distribution comes from the system's stratified draw (FR-2). *[AD-4, AD-6, AD-16, AD-N2, AD-N4]*
- **FR-4: Provider-agnostic LLM adapter** — select any configured (provider, model) per session; default `minimax/MiniMax-M3`; OpenRouter free models opt-in; SDKs dynamic-imported. *[AD-6, AD-18]*
- **FR-5: Quiz UI (one question at a time)** — answer + advance, prev/next, position tracking, submit at end; next/submit gated on ≥1 selected option (UI convenience; server-authoritative per FR-17). *[AD-17]*
- **FR-6: Geometric-weighted scoring** — `Σ(rawScoreᵢ × weightᵢ) / Σ(wᵢ)`, weights `1.0 × 1.1^(i-1)`. Multi-answer: `clamp(round(4 × (hits − misses) / |correct|, 2), 0, 4)`. Wrong picks cancel right picks; select-all → 0. *[AD-16]*
- **FR-7: Idempotent submission + inline results + insights** — `POST /submit` returns finalScore + breakdown + categoryBreakdown + insights in one response; `UNIQUE(session_id, question_id)`; atomic state transition; concurrent submits return cached result. *[AD-15, AD-16]*
- **FR-8: Per-endpoint ownership enforcement** — four-layer: interceptor UUID-v4 validation → use-case `findByIdAndUserId` (404) → session-scoped queries → Postgres RLS (function-based EXISTS-join + FORCE); companion lint rule `@ai-quiz/no-unscoped-session-query`. *[AD-9]*
- **FR-9: Chat-before-submit guard** — while `status='ready'`, LLM context omits `is_correct` + question text (redacted QuestionDto). *[AD-12]*
- **FR-10: Chat persistence (free text, fully decoupled, context-aware)** — persistent per-session thread; **no `questionId` anchor**; chat LLM context includes submit-time results + insights (this is why no insight endpoint exists); latest N=50, "view older" on demand. *[AD-14]*
- **FR-11: Tavily tool-calling (grounded answers)** — chat agent answers via web search; results dual-LLM summarized to ≤200 chars before entering context; max 2 tool iterations; post-quiz only. *[AD-13]*
- **FR-14: Provider list endpoint** — `GET /api/config/providers` returns configured (provider, model) set (default-deny); FE renders dropdown. *[AD-6, AD-17]*
- **FR-15: Ingest neutralization + output grounding** — deterministic (no-LLM) scrub of genuine injection vectors + NFKC normalize; never LLM-rewrite the source; structured output containment + plain-text Q/A render + grounding check + secret-shaped-token check. *[AD-N1]*
- **FR-16: Bounded critical path (single LLM call) + doc-size guard** — sync path `fetch → neutralize → chunk → select ~8k-token budget → 1 LLM call → validate pool → select categories → stratified-sample → persist → return`; async enrichment never a correctness dependency; no map-reduce; closed-world generation (no Tavily); tiered size guard + content-density check. *[AD-N2, AD-N3, AD-18, AD-19]*
- **FR-17: Complete submissions only** — `POST /submit` must carry exactly one response per session question, ID set matching exactly, else 400; server resolves position from `questions.position` (not request index). *[AD-N5, AD-15]*

### NonFunctional Requirements

- **NFR-1: Security (release-blocking)** — SSRF defense; four-layer ownership incl. Postgres RLS (v1 default); chat-before-submit guard; ingest neutralization + output grounding (no keyword blocklist); `X-User-Id` only (no HMAC binding); submit idempotency; pino redaction; CORS `NODE_ENV` gate (exact `WEB_ORIGIN` always; regex only when not production). *[AD-9, AD-10, AD-12, AD-N1, AD-N7, AD-N8]*
- **NFR-2: Rate limiting** — every route limited twice (per-`X-User-Id` AND per-IP, stricter wins); Global 30/min, `POST /sessions` 5/min, `POST /chat` 20/min; 429 + `Retry-After`; in-memory store accepted ONLY with `max_machines_running = 1`. *[AD-N7, AD-19]*
- **NFR-3: Observability** — Langfuse traces every LLM call (metadata; chat content scrubbed after 7 days); pino redaction (deny-list + allowlist); two health endpoints; per-session cost budget removed. *[AD-N9, AD-20]*
- **NFR-4: Testing discipline** — Vitest (unit scoring/aggregation in `packages/shared`, integration + security in `apps/api`); Playwright + Page Object Model, `data-testid` + `getByTestId` only; coverage floors (scoring ≥95%, use-cases ≥80%, adapters ≥60%); every story adds/updates tests; test results include gap analysis + insights. *[AD-N10]*
- **NFR-5: Frontend state** — TanStack Query v5 (query-keys factory `apps/web/lib/queries.ts`); React Context (UUID, theme) + `useState` + `useLocalStorage`; no Zustand/Redux; UUID generated in `<head>` before hydration. *[AD-17]*
- **NFR-6: Deployment topology** — Vercel (web) + Fly.io (API) + Neon (DB), free tiers; base image `node:22-slim` (Node ≥22.13.0); `max_machines_running = 1` required; migrations via `fly.toml release_command`; cron keep-warm ping `/healthz` every 4 min; two health endpoints. *[AD-19, AD-20]*
- **NFR-7: Provider rules (v1 scope)** — MiniMax (default `MiniMax-M3`, hyphen; auto caching; `MINIMAX_REGION` switch) + OpenRouter free models (opt-in; filtered `pricing.prompt = "0"`; fallback to MiniMax on failure **on the chat path only — disabled on the generation path**). Anthropic/OpenAI/Groq/Ollama deferred to v2. *[AD-6]*
- **NFR-8: Scoring math invariants** — 8-question geometric weights sum 11.4358881; categories compare by `avgRawScore` (not `weightedScore`); strength thresholds ≥3.0 strong / ≥1.6 & <3.0 mixed / <1.6 weak; `type='single'` exactly 1 correct, `multiple` 2–4; throws on n≤0. *[AD-16, AD-N5]*

### Additional Requirements

> From the Architecture Spine (29 ADs) + implementation reference §A.13 build order. **No starter template** — greenfield scaffold built from scratch (impacts Epic 1 Story 1).

- **Greenfield monorepo scaffold** — pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`; root TS / ESLint / Prettier; `docker-compose.yml` for local Postgres. *(No starter template.)*
- **Hexagonal architecture enforcement** — `domain/`, `ports/`, `use-cases/` pure; `adapters/` + `driving/` hold all I/O; ESLint `no-restricted-imports` blocks NestJS/Drizzle/Mastra/undici/node:fetch in domain; domain dir has its own `tsconfig.json`. *[AD-1, AD-2]*
- **Zod DTOs at every boundary** — `Object.freeze(Schema.parse(raw))` in every adapter; one schema per boundary in `packages/shared/src/schemas.ts`; no mapping layer. *[AD-3]*
- **Custom ESLint rules + tooling** — `@ai-quiz/no-unscoped-session-query`, `@ai-quiz/require-data-testid`, `@ai-quiz/no-console-log` (outside adapters); Prettier 3.x + husky + lint-staged; TypeScript strict + `noUncheckedIndexedAccess` + `noImplicitOverride`; `pnpm verify` = `lint:check && typecheck && test && test:e2e && build`. *[Consistency Conventions]*
- **Drizzle schema + migrations** — tables are created by the story that first needs them (Story 1.3 seeds only `users` + `quiz_sessions`; child tables land in their feature epics), each with the **RLS migration** pattern (function-based `current_session_user_id()` + `ENABLE` + `FORCE ROW LEVEL SECURITY` on every owned table + per-table EXISTS-join policies). *[AD-9, AD-14]*
- **Mastra integration** — `MastraModule.register()` imported LAST in `AppModule`; model strings `'provider/model'`; `@nestjs/platform-express` only (no Fastify). *[AD-7, AD-8]*
- **Lazy SDK loading** — default provider eager, others via `await import(...)`; avoids 256 MB Fly OOM. *[AD-18]*
- **Two health endpoints + resilience** — `/healthz` (process-alive, Fly) vs `/api/health` (deep DB + provider checks); Drizzle init in 5-attempt retry with backoff. *[AD-20]*
- **Deploy artifacts** — Dockerfile (`node:22-slim` multi-stage); `fly.toml` (`release_command` migrations, `max_machines_running = 1`); Vercel config; cron keep-warm. *[AD-19]*
- **Shared UI conventions (cross-story, binding)** — *added 2026-07-19; previously each UI story asserted "is responsive" with no value to agree on.*
  - **Single responsive breakpoint: `md` = 768 px.** Below it the result page collapses dual-panel → tabs and the history sidebar collapses → slide-out. Defined once as a Tailwind theme token and imported by every layout; **no story may hardcode its own value.** Stories 2.7, 3.2, 3.3, 5.1 and the Playwright mobile project all reference this one constant. *(Queue a memlog entry so the next spine re-distill carries it as an AD — it is a textbook "two units could choose incompatibly" invariant.)*
  - **`data-testid` on every interactive element**, lint-enforced via `@ai-quiz/require-data-testid`; tests use `getByTestId(...)` only.
  - **Shared empty / loading / error state components** live in `apps/web/components/states/` and are reused rather than re-implemented per surface.
- **README** (PRD §6.1 in-scope deliverable, build order step 17) — documents run, env vars, scoring rules, security posture, and deploy. Owned by Story 5.3 as part of the release gate.
- **Build order seed** (impl reference §A.13, 17 steps) — dependency-graph starting point for epic sequencing: scaffold → shared (schemas + scoring) → api skeleton → drizzle + migrations → adapters → Mastra LLM adapter → LlmPort impls → use-cases → driving layer → config endpoint → observability → web app → UI pages → Vitest → Playwright → Dockerfile/fly.toml → README.

### UX Design Requirements

_None — no UX design contract exists for this project. UI/interaction requirements are carried inline in FR-5 (quiz UI), FR-10 (chat/result dual-panel, mobile-first collapse to tabs, history sidebar), UJ-1..UJ-4 (PRD §2.3), and NFR-5 (frontend state). Mobile is a first-class surface (OQ-2 resolved 2026-07-19)._

### FR Coverage Map

- **FR-1** (SSRF ingest): Epic 2 — grounded quiz generation
- **FR-2** (strategy + question pool + stratified category selection): Epic 2
- **FR-3** (LLM question generation): Epic 2
- **FR-4** (provider-agnostic adapter): Epic 2
- **FR-5** (quiz UI): Epic 3 — take quiz & results
- **FR-6** (geometric-weighted scoring): Epic 1 — pure `packages/shared` module, consumed by Epic 3
- **FR-7** (idempotent submit + inline results + insights): Epic 3
- **FR-8** (per-endpoint ownership): Epic 1 (mechanism: interceptor + RLS + lint) + Epic 5 (final cross-user E2E); per-endpoint isolation tests carried by each feature epic via NFR-4
- **FR-9** (chat pre-submit guard): Epic 4 — chat & gap analysis
- **FR-10** (chat persistence, context-aware): Epic 4
- **FR-11** (Tavily tool-calling): Epic 4
- **FR-14** (provider list endpoint): Epic 2
- **FR-15** (ingest neutralization + grounding): Epic 2
- **FR-16** (bounded critical path + doc-size guard): Epic 2
- **FR-17** (complete submissions only): Epic 3

> NFR mapping: NFR-1/2/6/8 → Epic 1 (foundation/security/deploy/scoring). NFR-3 (observability) spans Epic 1 (pino + port) → Epic 2 (generation traces) → Epic 4 (chat traces + 7-day scrub); it is NOT closed by Epic 1 alone. NFR-5 (FE state) established in Epic 2, used throughout. NFR-7 (provider rules) → Epic 2. NFR-4 (testing) is cross-cutting — every epic's stories carry their own tests; Epic 5 adds the final full-journey + cross-user security E2E.

## Epic List

### Epic 1: Foundation, Security Spine & Deployable Skeleton
Stand up the greenfield monorepo, the fully-tested scoring engine, the DB + RLS migration, the reusable ownership/security substrate, observability, and the deploy pipeline — so every later feature inherits security and ships to a live skeleton. **Exit criterion (walking skeleton, not a config checklist):** a live ownership-enforced `POST /sessions` stub that persists a row, returns 404 on cross-user access, passes through the per-user+IP throttler, and responds via the deployed Fly skeleton (`/healthz` 200) — plus the scoring engine green at ≥95% Vitest coverage.
**FRs covered:** FR-6, FR-8 (mechanism: `@OwnsSession()` interceptor + AsyncLocalStorage `SET LOCAL` + Postgres RLS + `@ai-quiz/no-unscoped-session-query` lint rule)
**NFRs / additional:** NFR-1, NFR-2, NFR-3, NFR-6, NFR-8 · scaffold, hexagonal enforcement (ESLint `no-restricted-imports`), Zod-DTO boundary, tooling/`pnpm verify`, Drizzle `users`/`quiz_sessions` schema + RLS migration (child tables deferred to their feature epics), two health endpoints, Dockerfile `node:22-slim` + `fly.toml`

### Epic 2: Generate a grounded quiz from any URL
A user pastes a Markdown URL, picks a provider + strategy, and gets a playable quiz whose questions are grounded in the document. Establishes the FE state substrate (TanStack Query + UUID context) and the landing UI (URL input, provider dropdown, strategy picker, Start).
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-14, FR-15, FR-16
**NFRs:** NFR-7 (MiniMax default + OpenRouter free), NFR-5 (FE state established here)
**Deliverable:** pipecat & langchain READMEs each produce a **`status='ready'` grounded quiz, verified by API + integration test** (SM-1); SSRF security suite green; closed-world generation with tiered doc-size + content-density guard; landing page reaches `ready` and routes onward.
**Known seam:** the quiz is not yet *playable in the browser* — `/quiz/[id]` is Story 3.3 (Epic 3), which must land after the submit endpoint (3.1) and result page (3.2) it depends on. Epic 2's exit is verified at the API layer, not by a manual click-through.

### Epic 3: Take the quiz & get graded results with insights
A user answers one question at a time, submits a complete set, and sees final score + per-category breakdown + insights inline on a dual-panel result page. **First UI story builds the dual-panel result shell with an empty/disabled chat slot** (the extension point Epic 4 mounts into).
**FRs covered:** FR-5, FR-17, FR-7 (consumes the Epic-1 scoring engine)
**Deliverable:** answer → submit → inline score/breakdown/insights; idempotent retry never double-scores; per-endpoint ownership isolation test for submit/result routes.

### Epic 4: Chat, follow-ups & gap analysis
Persistent per-session chat mounted into the Epic-3 result-page chat slot: pre-submit answer-exfil guard, Tavily-grounded answers (dual-LLM sanitized), and gap analysis delivered conversationally from the submit-time insights (no separate insight endpoint).
**FRs covered:** FR-9, FR-10, FR-11
**NFRs:** NFR-3 (chat retention — 7-day scrub, Story 4.4)
**Deliverable:** per-session chat thread persists across revisits; pre-submit guard test green; "What should I study next?" answered from `topicsToStudy[]`; per-endpoint ownership isolation test for chat routes.

### Epic 5: Revisit history on any device
History sidebar listing all prior sessions, session revisit at `/result/[id]`, mobile-first responsive behavior (dual-panel → tabs, sidebar → slide-out), and resume of `pending` sessions — closed out by the end-to-end happy-path and cross-user isolation E2E specs.
**FRs covered:** FR-8 (final end-to-end cross-user isolation validation across all endpoints)
**NFRs:** NFR-4 (full Playwright POM suite: `landing.spec.ts`, `full-quiz.spec.ts`, `chat.spec.ts`, `security.spec.ts`)
**Deliverable:** mobile history revisit (UJ-3); full-journey + `security.spec.ts` (user A cannot read user B) green.

---

## Epic 1: Foundation, Security Spine & Deployable Skeleton

Stand up the greenfield monorepo, the fully-tested scoring engine, the DB + RLS migration, the reusable ownership/security substrate, observability, and the deploy pipeline — so every later feature inherits security and ships to a live skeleton. Exit criterion is a walking skeleton (live ownership-enforced `POST /sessions` + deployed), not a config checklist.

### Story 1.1: Monorepo scaffold & tooling gate

As a developer,
I want a pnpm-workspace monorepo with enforced hexagonal boundaries, formatting, and a single verify gate,
So that every change is boundary-safe and checked from the first commit.

**Acceptance Criteria:** _(AD-1, AD-2, Consistency Conventions)_

**Given** a clean clone,
**When** I run `pnpm install && pnpm verify`,
**Then** lint + typecheck + test + build all pass on the empty skeleton (test/build no-op until packages exist).

**Given** the three workspaces (`apps/api`, `apps/web`, `packages/shared`),
**When** an `apps/api/src/domain/**` file imports `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, or `node:fetch`,
**Then** ESLint fails via `no-restricted-imports` (AD-2).

**Given** a staged commit,
**When** the pre-commit hook runs,
**Then** husky + lint-staged run Prettier 3.x + ESLint on staged files and block on violation.

**Given** `tsconfig.base.json`,
**Then** `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` are enabled and inherited per-package.

**Given** `docker-compose.yml`,
**When** `docker compose up`,
**Then** a local Postgres 16 instance is reachable for dev.

### Story 1.2: Scoring engine in `packages/shared` (fully tested)

As a developer,
I want the pure scoring + aggregation module implemented and exhaustively unit-tested,
So that grading is provably correct before any API or UI consumes it.

**Acceptance Criteria:** _(FR-6, NFR-8, AD-16)_

**Given** the scoring module,
**Then** it exports `geometricWeights`, `scoreQuestion`, `weightedFinalScore`, `aggregateByCategory`, `rankWeakCategories`, `strengthFor` over frozen Zod DTOs from `packages/shared/src/schemas.ts`.

**Given** a `multiple` question,
**When** scored,
**Then** `raw = clamp(round(4 × (hits − misses) / |correct|, 2), 0, 4)`,
**And** fully-correct → 4, empty → 0, hit+miss → 0, and select-all → 0 across 2/3/4-correct shapes.

**Given** a `single` question,
**Then** raw = 4 iff the selected set equals the correct set, else 0.

**Given** `|correct| ≤ 0`,
**Then** `scoreQuestion` throws.

**Given** a `selected` array containing duplicate or out-of-range positions (e.g. `[0, 0, 5]`),
**Then** validation rejects it — positions must be unique integers in `[0, 3]` (AD-16).

**Given** 8 questions,
**Then** Σ geometric weights = 11.4358881,
**And** `weightedFinalScore` = Σ(rawᵢ × wᵢ) / Σwᵢ over contiguous positions 0..n−1.

**Given** category aggregation,
**Then** categories compare by `avgRawScore`,
**And** strength = ≥3.0 strong / ≥1.6 & <3.0 mixed / <1.6 weak.

**Given** an `avgRawScore` of exactly 3.0 and exactly 1.6,
**Then** the boundary values are tested explicitly and classify as `strong` and `mixed` respectively (boundaries exclusive of overlap).

**Given** the Vitest suite,
**Then** scoring-module coverage is ≥95% (enforced by a Vitest coverage threshold in `pnpm verify`, alongside the ≥80% use-case and ≥60% adapter floors from NFR-4), covering n=0/1/8, all-wrong, select-all=0, hit+miss cancel, negative-before-clamp, NaN guard, and rounding boundary.

### Story 1.3: API skeleton, DB foundation & health endpoints

As an operator,
I want a NestJS API wired to the hexagonal layout with the base data schema, a migration runner, and health checks,
So that the service boots, connects to Postgres, and reports liveness.

**Acceptance Criteria:** _(AD-1, AD-8, AD-14, AD-20, NFR-3, NFR-6)_

**Given** the NestJS app,
**Then** `apps/api/src` contains `domain/`, `ports/`, `use-cases/`, `adapters/`, `driving/`,
**And** it boots on `@nestjs/platform-express` with Node `>= 22.13.0` pinned in `engines`.

**Given** Drizzle setup,
**Then** migrations create only the `users` and `quiz_sessions` tables (child tables deferred to their feature epics).

**Given** `node dist/main.js migrate`,
**When** run,
**Then** pending Drizzle migrations apply (this is the `fly.toml` `release_command`).

**Given** `GET /healthz`,
**Then** it returns 200 in ~1ms (process-alive only).

**Given** `GET /api/health`,
**Then** it deep-checks DB reachability,
**And** Drizzle init retries up to 5× with exponential backoff.

**Given** the Neon connection,
**Then** it requires `?sslmode=require` with `statement_timeout: 10000` and `query_timeout: 15000`.

### Story 1.4: Per-session ownership + walking-skeleton sessions endpoint

As a user,
I want every session-scoped request verified as mine at both the app and database layers,
So that no one can read or mutate another user's session.

**Acceptance Criteria:** _(FR-8, NFR-1, AD-9)_

**Given** a request without a valid UUID-v4 `X-User-Id` on any authenticated route,
**Then** the identity middleware rejects it (400) before any DB query.

**Given** a valid `X-User-Id`,
**When** the identity middleware runs (on **every** authenticated route, not just `:id`-scoped ones),
**Then** it upserts `users` by `external_id`, resolves the internal `users.id`, opens the request transaction, and issues `SET LOCAL app.user_id = '<users.id>'`, propagated via AsyncLocalStorage so the use-case's Drizzle queries share the connection.

**Given** the GUC value,
**Then** it carries the internal `users.id` and **never** the raw browser `X-User-Id` — `X-User-Id` is `users.external_id` (text) while `quiz_sessions.user_id` FKs to `users.id` (uuid), so setting the GUC from the header would make every policy compare mismatched identifiers and silently deny all rows,
**And** the identity middleware is the sole owner of the `users` upsert (without it the first `POST /sessions` FK-violates).

**Given** `POST /sessions` (no `:id` in the route),
**Then** the GUC is still set by the identity middleware, so the initial `INSERT` into `quiz_sessions` passes the RLS `WITH CHECK` — binding the GUC to `@OwnsSession()` alone would reject the first write of every session.

**Given** a stub `POST /sessions`,
**When** called,
**Then** it persists a `quiz_sessions` row owned by the caller and returns its id.

**Given** `GET /sessions/:id` for a session owned by another user (or non-existent),
**Then** it returns 404 (not 403) via `findByIdAndUserId` — existence-leak prevention.

**Given** the RLS migration,
**Then** `quiz_sessions` has `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `user_owns_session` policy using `current_session_user_id()`,
**And** each owned table's policy is written against its actual columns — the six depth-1 tables join via `session_id`, while `answers` has **no `session_id`** and requires the depth-2 join `answers → questions → quiz_sessions`,
**And** with `app.user_id` unset a direct select returns 0 rows.

**Given** a `WHERE session_id = ?` query written outside a `forUser*` context or without an `assertUserOwns(...)` call,
**Then** the `@ai-quiz/no-unscoped-session-query` ESLint rule fails the build (tested against known-good/known-bad fixtures).

**Given** the ownership security test,
**Then** user A receives 404 for user B's session.

### Story 1.5: Network hardening (rate limiting, CORS, helmet, error shape)

As an operator,
I want every route rate-limited and hardened against cross-origin and malformed input,
So that the single-machine deployment resists abuse and leaks no internals.

**Acceptance Criteria:** _(NFR-1, NFR-2, AD-N7, AD-N8)_

**Given** `@nestjs/throttler` v6,
**Then** every route is limited twice (keyed by `X-User-Id` and by IP, stricter wins): Global 30/min, `POST /sessions` 5/min, `POST /chat` 20/min,
**And** exceeding a limit returns 429 with `Retry-After`.

**Given** CORS,
**Then** exact `WEB_ORIGIN` is always allowed and `WEB_ORIGIN_REGEX` is honored only when `NODE_ENV !== 'production'`,
**And** methods are `GET, POST` with `maxAge: 600`.

**Given** helmet,
**Then** a custom CSP and HSTS (2y + preload) are set.

**Given** body limits,
**Then** JSON/urlencoded bodies larger than 100 KB are rejected.

**Given** an unhandled error,
**Then** `SafeExceptionFilter` returns `{error: {code, message, requestId}}` with no stack trace.

**Given** the in-memory throttler store,
**Then** a boot-time guard reads the deployed `max_machines_running` and refuses to start when it is not exactly 1 — with N machines the per-machine counters silently multiply every limit by N,
**And** a test asserts the guard fires on a value of 2.

### Story 1.6: Observability & deploy the skeleton

As an operator,
I want structured redacted logging, LLM-tracing wiring, and a reproducible deploy to Fly + Neon + Vercel,
So that the walking skeleton runs live and is debuggable without leaking secrets.

**Acceptance Criteria:** _(NFR-3, NFR-6, AD-N9, AD-19)_

**Given** pino,
**Then** logs redact `Authorization`, `x-api-key`, `cookie`, `x-user-id`, `req.body.*`, all `*_KEY`/`*_SECRET`, and `*.apiKey`,
**And** allowed fields include `requestId`, `route`, `status`, `latency_ms`, `user_id_hash` (SHA-256, not the raw UUID).

**Given** the Langfuse adapter,
**Then** the port interface and adapter exist and a test asserts a synthetic trace is emitted and flushed,
**And** tracing of real LLM calls lands with those calls in Stories 2.4 and 4.2 — this story does not close NFR-3/SM-5 on its own.

**Given** the Dockerfile,
**Then** it uses `node:22-slim` multi-stage (not node:20, not alpine).

**Given** `fly.toml`,
**Then** `max_machines_running = 1` and `release_command` runs migrations,
**And** the Fly healthcheck targets `/healthz`.

**Given** an external cron pinging `/healthz` every 4 min,
**Then** the auto-stopped machine is kept warm.

**Given** a deploy,
**Then** the web skeleton is on Vercel, the API on Fly, the DB on Neon,
**And** `/healthz` returns 200 within 30s of boot (SM-4).

---

## Epic 2: Generate a grounded quiz from any URL

A user pastes a Markdown URL, picks a provider + strategy, and gets a grounded quiz generated and persisted. Establishes the FE state substrate (TanStack Query + UUID context) and the landing UI.

> **Epic boundary:** generation ends at `status='ready'`. Playing the quiz is Epic 3 — `/quiz/[id]` (Story 3.3) must follow the submit endpoint (3.1) and result page (3.2) it posts to and navigates to. Epic 2 is verified at the API/integration layer.

### Story 2.1: SSRF-safe markdown ingest

As a user,
I want an arbitrary Markdown URL fetched safely,
So that I can quiz on real docs without the server being tricked into hitting internal networks.

**Acceptance Criteria:** _(FR-1, AD-10)_

**Given** a non-http(s) scheme (`file:`, `gopher:`, `ftp:`),
**Then** the fetch is rejected (`SsrfBlockedError`).

**Given** a blocklisted host/IP (localhost, 0.0.0.0, IMDS hostnames, RFC1918, loopback, link-local, CGN 100.64/10, Oracle 192.0.0/24, benchmarking 198.18/15, multicast, reserved, IPv6 ULA, 6to4),
**Then** it is rejected — including short-form (`127.1`, `0`, decimal) via `net.isIP()` and `::ffff:` IPv4-mapped normalization.

**Given** DNS resolution,
**Then** the validated IP is pinned and the undici `Agent` binds to it (defeats rebinding),
**And** redirects are disabled.

**Given** an IDN homograph (punycode mismatch) or an HTTP/0.9 response or a non-`text/markdown`/`text/plain` content-type,
**Then** it is rejected.

**Given** a GitHub `blob` URL,
**Then** it is rewritten to `raw` before fetch.

**Given** an HTTP body larger than 10 MB or 10s elapsed,
**Then** the fetch aborts,
**And** the 10 MB cap is enforced during streaming decode rather than read from the `Content-Length` header, so a server under-reporting its body size is still cut off mid-stream.

**Given** the SSRF suite in `apps/api/test/security/`,
**Then** it covers RFC1918 × IPv4/IPv6, loopback, IMDS hostnames, all non-http(s) schemes, and IDN homograph.

### Story 2.2: Neutralize & chunk the document, with size/density guard

As a user,
I want my document cleaned of injection vectors and size-checked before generation,
So that untrusted markdown can't steer the model and oversized/tiny docs fail fast with a clear hint.

**Acceptance Criteria:** _(FR-15 ingest-side, FR-16 doc-size, AD-N1, AD-N3)_

**Given** fetched markdown,
**Then** `neutralize` NFKC-normalizes and strips C0/C1 controls (except `\t\n\r`), zero-width + bidi chars, `<script>`/event handlers/`<iframe>`/`<object>`/`<embed>`/`<applet>`/`<meta http-equiv>`, `javascript:`/`data:text/html` URIs, and base64 data-URI blobs.

**Given** neutralization,
**Then** HTML comments, link titles, image alt text, other raw HTML (`<kbd>`, `<sup>`, `<details>`…), and code blocks are preserved,
**And** the source is never LLM-rewritten.

**Given** decoded markdown larger than 2 MB,
**Then** `400 DOC_TOO_LARGE` before any LLM call.

**Given** estimated tokens exceeding the chosen model's context window,
**Then** `400 DOC_TOO_LARGE` with a switch-model hint.

**Given** `doc_tokens / questionCount < ~500`,
**Then** `400 DOC_TOO_SHORT` with a reduce-questionCount hint.

**Given** a valid doc,
**Then** the chunker splits by headings synchronously,
**And** chunk selection is deterministic — feeding the same `(document, questionCount)` twice yields a byte-identical chunk set (asserted by test). Determinism is scoped to **chunk selection only**; model sampling must vary across retries, or every retry lands on the same failure (AD-N4).

**Given** a document with no `##`/`###` headings at all,
**Then** the chunker still produces at least one chunk (the whole document) rather than zero.

**Given** a document that is empty after neutralization (for example one consisting entirely of `<script>` blocks),
**Then** it is rejected as `400 DOC_TOO_SHORT` before any LLM call.

### Story 2.3: Provider-agnostic LLM adapter + provider list endpoint

As a user,
I want to pick from the configured providers/models,
So that I can choose cost/quality per session without code changes.

**Acceptance Criteria:** _(FR-4, FR-14, NFR-7, AD-6, AD-18)_

**Given** the `PROVIDER_CAPABILITIES` map,
**Then** `MastraLlmAdapter` routes `'provider/model'` strings,
**And** MiniMax is the default via inline `url` form, OpenRouter free via the built-in adapter.

**Given** MiniMax,
**Then** the model id is `MiniMax-M3` (hyphen), auto-caching only, `reasoning_details` round-tripped,
**And** `MINIMAX_REGION` switches host.

**Given** OpenRouter,
**Then** models are filtered by `pricing.prompt = "0"` from the live list,
**And** a free-tier failure falls back to MiniMax-M3 (single retry) **on the chat path only** — the fallback is disabled on the generation path, where the use-case is the sole retry authority (a mid-flight model swap changes the retry budget class and compounds to ~6 LLM calls, blowing the ~30s sync ceiling).

**Given** lazy loading,
**Then** the default provider loads eagerly and others via `await import(...)`,
**And** `/api/health` exposes `memoryUsage()` in non-prod.

**Given** `GET /api/config/providers`,
**Then** it returns only providers whose env keys are set (default-deny): `{minimax:[…], openrouter:[…free]}` when both set, `[]` when neither.

**Given** the OpenRouter live catalog fetch fails (network error or non-200),
**Then** the endpoint degrades to MiniMax-only rather than returning 5xx.

### Story 2.4: Generate the question pool (single structured call) & validate it

As a user,
I want 5–8 grounded questions generated from my document in one LLM call,
So that I get a playable quiz quickly without off-document or injected content.

> **Split note (2026-07-19):** Stories 2.4 / 2.5 / 2.6 were one story. It bundled ~15 independent concerns, which is how a refuted feasibility rule survived inside it undetected. 2.4 ends when a validated pool exists; 2.5 owns the selection algorithm; 2.6 owns persistence, failure state, and the response.

**Acceptance Criteria:** _(FR-2 request contract, FR-3, FR-15 output-side, FR-16 critical path, AD-4, AD-16, AD-N1, AD-N2, AD-N4 steps 1–2)_

**Given** `POST /sessions` with a required `strategy` (factual|comprehension|mixed|trivia), a `questionCount` integer in `[5,8]` (Zod-validated, default 8), and an optional `topic` (≤200 chars, hint not instruction),
**Then** a session is created and `questionCount` persists to `quiz_sessions.question_count`,
**And** a missing or invalid strategy, or a `questionCount` outside `[5,8]`, returns 400.

**Given** the sync critical path,
**Then** **this story owns its first half** — `fetch → neutralize → chunk → select ~8k-token budget → 1 structured LLM call (question pool) → validate pool` — ending when a validated pool exists in memory, with no Tavily/web search (closed-world),
**And** the remaining steps `select categories → stratified-sample` (Story 2.5) and `persist → return` (Story 2.6) are pure system-side work after the call returns, which is what makes the single-LLM-call constraint genuinely hold,
**And** the full end-to-end path is asserted once, in Story 2.6.

**Given** the single LLM call,
**Then** it returns a pool of `ceil(questionCount × 1.5)` questions (Q=8 → 12, Q=5 → 8), each tagged with a model-derived `category`,
**And** the prompt bounds the pool to **4–8 distinct category tags total** (a soft cardinality bound, not exact allocation) so a feasible stratified draw always exists,
**And** the model is not asked to allocate questions across categories — the system handles allocation.

**Given** each pool question,
**Then** Zod enforces exactly 4 answers, `single` = exactly 1 correct, `multiple` = 2–4 correct, and a non-empty `category` string.

**Given** pool validation,
**Then** every pool question is grounding-checked and secret-shaped-token-checked before any selection occurs.

**Given** `V` valid questions survive validation,
**Then** the ladder **classifies** the outcome — `V >= questionCount` → proceed at full count; `5 <= V < questionCount` → proceed with `Q = V` and carry `actualCount = V`; `V < 5` **or** fewer than 2 distinct categories → regenerate the whole pool on the retry budget (1 strict / 2 best-effort), and on exhaustion raise `UntrustedLlmOutputError`,
**And** this story owns the **classification and the retry**; Story 2.6 owns **writing** the resulting terminal state (`ready` + `actualCount`, or `failed`),
**And** `failed` is reachable ONLY via that last branch — a shortfall above the floor of 5 is never `failed`, and `400 DOC_TOO_SHORT` is never emitted here (it belongs to the pre-LLM doc-size guard).

**Given** a generation retry,
**Then** the provider fallback is disabled on this path (no OpenRouter→MiniMax swap mid-flight) and total LLM calls are hard-capped at the retry budget, so the ~30s sync ceiling holds.

**Given** every LLM call on the generation path,
**Then** a Langfuse trace is emitted carrying prompt, completion, latency, tokens, model, provider, cache hit/miss, `sessionId`, and `userId` (NFR-3, SM-5) — this closes the tracing deferral recorded in Story 1.6.

### Story 2.5: Category feasibility search & stratified draw

As a user,
I want my quiz drawn evenly across the document's knowledge areas,
So that my per-category scores rest on comparable evidence rather than one lucky question.

**Acceptance Criteria:** _(FR-2 selection, AD-N4 step 3, NFR-8)_

**Given** category selection from the validated pool,
**Then** a `category → available count` map is built from the **valid** pool,
**And** availabilities are sorted descending `a₁ ≥ … ≥ a_m` (`m` = distinct categories in the valid pool, `m ≤ 8` by the prompt's tag cap).

**Given** a candidate category count `C`, with `k = floor(Q/C)` and `r = Q mod C` over the top-`C` categories,
**Then** feasibility is decided by **`feasible(C) ⟺ a_C ≥ k AND (r = 0 OR a_r ≥ k+1)`**,
**And** **every** `C` in `[2, min(8, m)]` is evaluated — this is a **search, not a decrement** — preferring a random feasible `C` in `[4,6]`, else any feasible `C`,
**And** `C` remains independent of `questionCount`; the feasibility search is not coupling.

**Given** the two known counter-examples,
**Then** tests assert both: with `Q=8` and availabilities `5,1,1,1,1,1,1,1` no `C` in `[2,6]` is feasible but `C=8` is (proving feasibility is **non-monotone in `C`**, so a decrementing rule can never reach it),
**And** with `Q=7, C=3, a=3,3,1` the superseded predicate `Σ min(aᵢ, ceil(Q/C)) ≥ Q` passes (3+3+1 = 7) while no legal 3-2-2 split exists (proving that sum is **necessary but not sufficient**).

**Given** no `C` is feasible at the current `Q`,
**Then** `Q` is decremented and the search re-run, reusing the `actualCount` path from Story 2.4 with floor `Q = 5`; below that the session reaches `failed` (AD-N4 step 3).

**Given** a feasibility assertion,
**Then** it holds before any question is drawn.

**Given** the stratified draw,
**Then** `questionCount` questions are drawn from the validated pool evenly across the selected categories — each receives `floor(Q/C)` or `ceil(Q/C)`, so counts differ by ≤1,
**And** a count of 0 is permitted when `questionCount < categoryCount` (e.g. 5 questions across 6 categories → 1,1,1,1,1,0).

**Given** a naive random draw across the whole pool (ignoring category strata),
**Then** it is rejected by test — a fixture that concentrates questions in one category must fail, because skewed per-category counts destroy `avgRawScore` comparability and make gap analysis noise.

**Given** the draw ordering,
**Then** it is deterministic given the seed, so per-category `weighted_score` is not biased by incidental position assignment,
**And** positions are assigned `0..Q-1` after the draw (AD-N4 step 3).

### Story 2.6: Persist the quiz, failure state & enrichment

As a user,
I want my generated quiz stored and returned safely,
So that revisiting the session shows the same quiz and a failed generation shows me an error instead of vanishing.

**Acceptance Criteria:** _(FR-2 persistence, FR-15 output-side, FR-16 async enrichment, AD-N1, AD-N4, AD-9, AD-16)_

**Given** the completed draw,
**Then** it is persisted once per session and never re-run,
**And** re-reading the session returns the identical quiz (replay value comes from randomness across sessions, not within one).

**Given** an under-generating pool,
**Then** Story 2.4's shortfall ladder is the single authority — `5 <= V < questionCount` returns `ready` with `actualCount`, and only `V < 5` (or fewer than 2 distinct categories) reaches `failed`,
**And** the quiz is never padded with filler questions.

**Given** a question with no meaningful token overlap with any source chunk,
**Then** it is excluded from the valid pool before selection and the shortfall ladder decides the outcome,
**And** when the ladder reaches `failed`, the `status='failed'` row is written in its own separately-committed transaction before `UntrustedLlmOutputError` propagates — otherwise the request transaction rolls back and erases the row the UI renders.

**Given** output with a secret-shaped token (`sk-…`, `AKIA…`, high-entropy) absent from the source,
**Then** it is retried on the same budget.

**Given** success,
**Then** questions/answers persist without `is_correct` exposed and `documents` rows are created (with `ENABLE`+`FORCE` RLS + policies),
**And** generation **never** inserts `knowledge_categories` rows — `SubmitAnswersUseCase` is their sole creator (Story 3.1),
**And** `async enrich(sessionId, userId)` runs off the critical path, opening its own transaction and issuing `SET LOCAL app.user_id` before any write (the request transaction has already committed, so without this every enrichment write is silently rejected by FORCE RLS), and is never a correctness dependency.

**Given** the response,
**Then** it returns the questions (no `is_correct`) with `status='ready'`,
**And** new session-scoped reads use `@OwnsSession()` and carry an ownership isolation test.

**Given** SM-1,
**Then** generation succeeds end-to-end on the pipecat and langchain READMEs.

### Story 2.7: Landing page & quiz start flow

As a user,
I want to paste a URL, pick a provider and strategy, and start,
So that I reach a playable quiz.

**Acceptance Criteria:** _(FR-5 start, FR-14, NFR-5, AD-17)_

**Given** the Next.js app,
**Then** Tailwind + shadcn/ui + TanStack Query v5 (query-keys factory in `lib/queries.ts`) + React Context (UUID, theme) + `useLocalStorage` are wired,
**And** the UUID is generated in a `<head>` inline script before hydration.

**Given** the landing page,
**Then** it has a URL input, a provider/model dropdown populated from `GET /api/config/providers`, a required strategy picker, a `questionCount` control (5–8, default 8), and a Start button,
**And** all interactive elements have `data-testid`.

**Given** Start with a valid URL + strategy,
**When** clicked,
**Then** it POSTs `/sessions` with `X-User-Id` and, on `status='ready'`, routes to `/quiz/[id]`,
**And** the route **target** is delivered by Story 3.3 — within Epic 2 this AC is satisfied by asserting the POST succeeds and the router is invoked with `/quiz/[id]` (see the Epic 2 seam note).

**Given** Start is clicked and the LLM call is in flight (5–30 s per [A-8]),
**Then** the UI shows a non-blocking progress affordance with elapsed-time feedback, and Start plus all form controls are disabled for the duration — never a bare indefinite spinner (UJ-1).

**Given** a generation failure,
**Then** the UI shows a retry button (not an infinite spinner) per UJ-1.

**Given** a `429` response with `Retry-After` (NFR-2 caps `POST /sessions` at 5/min, which a user retrying a failed generation can reach),
**Then** the UI shows a rate-limited state naming the wait in seconds and re-enables Start when it elapses, rather than surfacing a generic failure.

**Given** `GET /api/config/providers` returns an empty list (no provider keys configured),
**Then** the landing page shows an explicit "no providers configured" state and disables Start with an explanation, rather than presenting an empty dropdown and a dead button.

**Given** a viewport narrower than the shared `md` breakpoint (768 px),
**Then** the landing layout reflows to single-column with the form controls full-width,
**And** the breakpoint is read from the shared token, never hardcoded in this story.

---

## Epic 3: Take the quiz & get graded results with insights

A user answers one question at a time, submits a complete set, and sees final score + per-category breakdown + insights inline on a dual-panel result page. Stories are ordered backend → result-page shell → quiz UI so that no story depends on a later one (the quiz UI's submit endpoint and navigation target must already exist).

### Story 3.1: Submit, score & serve results

As a user,
I want my complete submission scored once and returned with my category breakdown and study insights,
So that I immediately see how I did and what to study next.

**Acceptance Criteria:** _(FR-7, FR-17, FR-6 consumed, AD-15, AD-16, AD-N5)_

**Given** `POST /submit`,
**When** the payload does not carry exactly one response per session question with an ID set matching the session's exactly,
**Then** it returns 400 (missing or extra IDs).

**Given** a response whose `selected` array is empty,
**Then** `POST /submit` returns 400 — every response must carry at least one selected position, with the server authoritative and FR-5's client gate treated as convenience only,
**And** `scoreQuestion` retains its empty→0 branch as pure-function robustness, unreachable through the API.

**Given** a submit,
**Then** the server resolves each response's `position` from `questions.position` by `question_id`, not from the request array index.

**Given** scoring,
**Then** raw and weighted scores use the `packages/shared` scoring module,
**And** `finalScore` = `weightedFinalScore` over contiguous positions.

**Given** idempotency,
**Then** `user_responses` has `UNIQUE(session_id, question_id)` and the state transition is atomic (`UPDATE quiz_sessions SET status='submitted' WHERE id=? AND status='ready' RETURNING`),
**And** a duplicate or concurrent submit returns the same cached result and never 5xx.

**Given** a submit against a session whose status is `pending` or `failed`,
**Then** it returns 409 Conflict with the current status in the body — distinct from the 200 cached-result path for an already-`submitted` session.

**Given** a successful submit,
**Then** the single response contains `finalScore`, `breakdown[]` (questionId, position, rawScore, weight, weightedScore, correctAnswers), `categoryBreakdown[]`, and `insights {topicsToStudy[], weakCategories[], strengthByCategory}` computed synchronously.

**Given** `knowledge_categories`,
**Then** `SubmitAnswersUseCase` is the **sole creator** of these rows — generation never inserts them and async enrichment may only recompute aggregates on existing rows,
**And** a row is materialized only for categories that received at least one question — a selected-but-unused category never appears in `categoryBreakdown`, which eliminates the `0/0 = NaN` `avgRawScore` path,
**And** `correct_count`, `avg_raw_score`, `weighted_score`, and `strength` are populated for each materialized row,
**And** categories compare by `avgRawScore`.

**Given** `GET /sessions/:id`,
**Then** a submitted session returns results + insights,
**And** a ready session returns questions without `is_correct`.

**Given** ownership,
**Then** submit and result routes use `@OwnsSession()`,
**And** cross-user access returns 404 (isolation test).

**Given** the `user_responses` and `insights` tables,
**Then** each has `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy.

### Story 3.2: Result page (dual-panel shell + results panel)

As a user,
I want a result page showing my score, per-category breakdown, and study insights,
So that I understand my performance at a glance.

**Acceptance Criteria:** _(FR-7 display, AD-15, AD-17)_

**Given** `/result/[id]`,
**Then** it renders a dual-panel layout with a results panel and an empty/disabled chat slot (the Epic 4 mount point).

**Given** a submitted session,
**Then** the results panel shows `finalScore`, the per-question breakdown, `categoryBreakdown`, and `insights` inline, with no separate "Analyze gaps" trigger.

**Given** a viewport narrower than the shared `md` breakpoint (768 px),
**Then** the dual-panel layout collapses to tabs (results tab + chat tab),
**And** the breakpoint is read from the shared token, never hardcoded in this story.

**Given** all interactive elements,
**Then** they have `data-testid`,
**And** tests use `getByTestId(...)` only.

**Given** question and answer text,
**Then** it renders as plain text (auto-escaped), never markdown or HTML.

### Story 3.3: Quiz-taking UI (one question at a time)

As a user,
I want to answer questions one at a time and submit a complete set,
So that I can take the quiz and get graded.

**Acceptance Criteria:** _(FR-5, FR-17 client gate, AD-17)_

**Given** `/quiz/[id]` for a `ready` session,
**Then** questions load without `is_correct` and render one at a time with prev/next and position tracking.

**Given** `/quiz/[id]` for a session that is **not** `ready` — Story 5.1 routes `pending` sessions here, so this is reachable —
**Then** a `submitted` session redirects to `/result/[id]`, a `failed` session shows the error state with a retry affordance, and a `pending` session shows the generation-in-progress state; none render an empty or broken quiz.

**Given** a question,
**Then** next/submit is gated on at least one selected option (FR-5),
**And** the server remains authoritative (FR-17).

**Given** the last question is answered,
**When** Submit is clicked,
**Then** it POSTs the complete response set and navigates to `/result/[id]` on success.

**Given** all interactive elements,
**Then** they have `data-testid`.

**Given** a viewport narrower than the shared `md` breakpoint (768 px),
**Then** the quiz UI reflows to single-column with full-width answer targets,
**And** the breakpoint is read from the shared token, never hardcoded in this story.

---

## Epic 4: Chat, follow-ups & gap analysis

Persistent per-session chat mounted into the Epic 3 result-page chat slot: pre-submit answer-exfil guard, Tavily-grounded answers (dual-LLM sanitized), and gap analysis delivered conversationally from the submit-time insights. Chat is **free text, fully decoupled from questions** — no `questionId` anchor anywhere (decision 2026-07-19).

### Story 4.1: Chat backend — persistence + pre-submit guard

As a user,
I want a persistent chat thread per session that can't leak answers before I submit,
So that I can ask follow-ups safely and revisit the conversation later.

**Acceptance Criteria:** _(FR-9, FR-10, AD-12, AD-14)_

**Given** the `chat_messages` table,
**Then** it has `session_id`, `role` (`user`|`assistant`), `content` (≤8000), nullable `sources`/`tool_calls`/`model`/`thinking`, `created_at`, and `INDEX (session_id, created_at)`, with `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy,
**And** it has no `question_id` column — chat is fully decoupled from questions.

**Given** `POST /sessions/:id/chat`,
**Then** the request body accepts only `content` — there is no `questionId` field,
**And** there is no focused-context branch in the chat flow.

**Given** a chat request while `status='ready'`,
**Then** the LLM context receives a redacted `QuestionDto` with no `is_correct` and no question text (unit test asserts the redacted shape).

**Given** a chat request against a `failed` or `pending` session,
**Then** it is refused with 409 and the current status — the guard must not fall through to the `submitted` branch and expose answers for a session that never produced any.

**Given** `status='submitted'`,
**Then** the LLM context includes `finalScore`, `breakdown`, `categoryBreakdown`, and `insights.topicsToStudy` / `weakCategories` loaded as system content at session start.

**Given** a chat request,
**Then** both the user and assistant turns persist and are returned,
**And** content is Zod-capped at 8000 chars.

**Given** a chat history load,
**Then** the latest 50 messages are returned with no `LIMIT`/`OFFSET` pagination,
**And** older batches load on demand.

**Given** ownership,
**Then** the chat route uses `@OwnsSession()`,
**And** cross-user access returns 404 (isolation test).

### Story 4.2: Tavily tool-calling with dual-LLM sanitization

As a user,
I want the chat agent to search the web when my question goes beyond the document,
So that I get grounded answers without tool results poisoning the agent.

**Acceptance Criteria:** _(FR-11, AD-13)_

**Given** `WebSearchPort` and `TavilySearchAdapter`,
**Then** the chat agent may invoke at most 2 tool iterations per turn.

**Given** a Tavily result,
**Then** it is summarized by a secondary LLM call to ≤200 chars before entering the main agent context (dual-LLM pattern).

**Given** the summarizer,
**Then** it cannot invoke tools, raw HTML/markdown never crosses into the main context,
**And** it runs on a different provider than the main agent whenever `GET /api/config/providers` exposes more than one; with a single configured provider it runs as a separate call with a tool-free system prompt, and a test asserts both branches.

**Given** quiz generation (Epic 2),
**Then** Tavily is never invoked — web search is confined to post-quiz chat, preserving closed-world generation.

**Given** a chat turn that used tools,
**Then** `tool_calls` and `sources` persist on the message for display.

**Given** every LLM call on the chat path (main agent and the dual-LLM summarizer),
**Then** a Langfuse trace is emitted with prompt, completion, latency, tokens, model, provider, cache hit/miss, `sessionId`, and `userId` (NFR-3, SM-5).

### Story 4.3: Chat panel UI (mounted into the result-page shell)

As a user,
I want a chat panel on my result page,
So that I can ask questions and get study guidance conversationally.

**Acceptance Criteria:** _(FR-10 UI, UJ-2, UJ-4)_

**Given** the Epic 3 result page,
**Then** the chat panel mounts into the existing chat slot without rewriting the results panel.

**Given** the chat panel,
**Then** it renders the thread (latest 50) with a "view older" control and a message input,
**And** all interactive elements have `data-testid`.

**Given** the "Explain Q3" control on a question,
**When** clicked,
**Then** it pre-fills the chat input with `Explain question 3 — I answered {correctly|incorrectly}: {selection}` purely client-side,
**And** the question reference lives in the message text with no anchor sent to the server.

**Given** the message "What should I study next?",
**Then** the response draws on `insights.topicsToStudy` with no separate insight API call.

**Given** assistant content,
**Then** DOMPurify sanitizes it (scoped to chat + explanations only) with `rel="noopener noreferrer"` on `target="_blank"`,
**And** question and answer text still render as plain text.

**Given** a viewport narrower than the shared `md` breakpoint (768 px),
**Then** chat is reachable via the chat tab and the input is mobile-friendly,
**And** the breakpoint is read from the shared token, never hardcoded in this story.


### Story 4.4: Chat content retention (7-day scrub)

As a user,
I want my raw chat content removed after a week,
So that a conversation about my learning gaps is not retained indefinitely.

**Acceptance Criteria:** _(NFR-3, PRD §10.3, constitution rule 9)_

**Given** `chat_messages` rows older than 7 days,
**When** the scrub job runs,
**Then** their `content` (and any `thinking` / `sources` payload) is nulled or replaced with a tombstone marker while the row, `role`, and `created_at` are retained for thread structure.

**Given** Langfuse,
**Then** raw chat content in captured traces is scrubbed on the same 7-day boundary, leaving trace metadata intact.

**Given** the scheduling surface,
**Then** the job is driven by the same external cron already required for the `/healthz` keep-warm ping (NFR-6) — no queue, no Redis, no BullMQ (constitution) — and is exposed as an idempotent, authenticated maintenance route.

**Given** the job runs twice over the same window,
**Then** the second run is a no-op (idempotent).

**Given** a scrubbed session is revisited,
**Then** the thread renders with tombstones rather than erroring, and the result/insights panels are unaffected.
---

## Epic 5: Revisit history on any device

History sidebar listing all prior sessions, session revisit, resume of `pending` sessions, and the end-to-end suites that close out FR-8 (cross-user isolation) and NFR-4 (full Playwright POM suite). Per-surface mobile responsiveness is already an acceptance criterion in the landing, quiz, and result stories; this epic covers the history surface and whole-journey verification.

### Story 5.1: Session history & revisit

As a returning user,
I want to see my past sessions and reopen one,
So that I can review what I got wrong later, on any device.

**Acceptance Criteria:** _(UJ-3, FR-8 consumed, AD-17)_

**Given** `GET /sessions`,
**Then** it returns only the caller's sessions (scoped by `user_id`, newest first) via `idx_quiz_sessions_user_id_created_at`,
**And** another user's sessions never appear.

**Given** the history sidebar on the landing page,
**Then** it lists prior sessions with source URL, status, and created date,
**And** all interactive elements have `data-testid`.

**Given** a viewport narrower than the shared `md` breakpoint (768 px),
**Then** the sidebar collapses to a slide-out,
**And** the breakpoint is read from the shared token, never hardcoded in this story.

**Given** a submitted session is clicked,
**Then** it navigates to `/result/[id]`,
**And** the results, insights, and chat thread load as previously seen.

**Given** a `pending` or `ready` session is clicked,
**Then** the user resumes it at `/quiz/[id]` with status preserved in the DB (UJ-3 edge case).

**Given** a `failed` session,
**Then** it is shown with an error state and a retry affordance.

**Given** ownership,
**Then** `GET /sessions/:id` for another user's session returns 404.

**Given** a first-time user with zero sessions,
**Then** the sidebar shows an empty state rather than a blank or broken panel.

**Given** a user with a large session history,
**Then** `GET /sessions` is bounded (capped page size with a load-more affordance) rather than returning an unbounded result set.

### Story 5.2: Playwright POM + happy-path E2E

As a developer,
I want the end-to-end suite with Page Object Model covering the full journey,
So that regressions in the user flow are caught before release.

**Acceptance Criteria:** _(NFR-4, AD-N10, SM-3)_

**Given** `apps/web/e2e/pages/`,
**Then** POM classes exist (`BasePage`, `LandingPage`, `QuizPage`, `ResultPage`),
**And** all specs use them.

**Given** selector discipline,
**Then** tests use `getByTestId(...)` only — no CSS or text selectors,
**And** the CI lint rule rejects interactive elements lacking `data-testid`.

**Given** `landing.spec.ts`,
**Then** it covers URL entry, provider dropdown, strategy selection, and start.

**Given** `full-quiz.spec.ts`,
**Then** it covers the canonical happy path: generate → answer all → submit → results + category breakdown + insights inline (UJ-1).

**Given** `chat.spec.ts`,
**Then** it covers a post-submit message receiving a grounded response,
**And** the client-side "Explain Qn" prefill.

**Given** a Playwright mobile viewport project sized below the shared `md` breakpoint (768 px),
**Then** the happy path passes with dual-panel → tabs and sidebar → slide-out,
**And** the project's viewport width derives from the same shared token as the components.

**Given** CI,
**Then** the run order is `shared → api → web:e2e`,
**And** suite wall-clock is recorded as a tracked budget (Vitest ~30 s, Playwright ~2 min) reported on each run — a regression signal, not a hard gate, since timing assertions on unwritten code flake in CI.

### Story 5.3: Cross-user isolation E2E + security sweep

As a security-conscious operator,
I want end-to-end proof that one user cannot reach another's data,
So that the ownership guarantee is verified across every endpoint, not just per-unit.

**Acceptance Criteria:** _(FR-8 e2e closure, NFR-1, AD-9)_

**Given** `security.spec.ts` with two distinct `X-User-Id` values,
**Then** user A receives 404 for user B's session, results, and chat on every session-scoped route.

**Given** the database layer,
**Then** with `app.user_id` unset a direct query against each owned table returns 0 rows,
**And** RLS + `FORCE` are verified on `quiz_sessions`, `documents`, `questions`, `answers`, `user_responses`, `insights`, `knowledge_categories`, and `chat_messages`.

**Given** the chat pre-submit guard,
**Then** an end-to-end attempt to extract answers via chat while `status='ready'` fails, with no `is_correct` and no question text in the response.

**Given** the `@ai-quiz/no-unscoped-session-query` lint rule,
**Then** `pnpm verify` fails on a known-bad fixture and passes on a known-good one.

**Given** the README,
**Then** it documents run, env vars, scoring rules, security posture, and deploy (PRD §6.1).

**Given** the full suite,
**Then** `pnpm verify` (`lint:check && typecheck && test && test:e2e && build`) is green — the release gate.

**Given** SM-2 and SM-3,
**Then** all Vitest suites and the Playwright happy path pass.
