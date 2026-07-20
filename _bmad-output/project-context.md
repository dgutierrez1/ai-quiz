---
project_name: 'ai-quiz'
sections_completed:
  ['technology_stack', 'architecture_rules', 'security_rules', 'testing_rules', 'workflow_rules']
last_updated: '2026-07-19'
---

# Project Context — ai-quiz

This document is the **constitution** for the ai-quiz project. It is auto-loaded by all BMAD implementation workflows. Do not duplicate or contradict this file — extend it when project rules evolve.

## Authoritative source

- The **PRD** at `_bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md` is the single BMAD canonical spec — vision, JTBDs, UJs, FRs, NFRs, architecture addendum. All downstream artifacts read from this one file.
- The original detailed SPEC.md (875 lines) is archived at `_bmad-output/archive/SPEC-2026-07-16.md`. ⚠️ **It is frozen at 2026-07-16, unmaintained, and NOT authoritative.** An adversarial audit on 2026-07-16 **superseded** several of its rules. Read it for history only; **never** re-derive a rule from it. Where the archive and the PRD disagree, **the PRD wins**.
- This `project-context.md` is the implementation constitution (rules agents must follow).

> **Audit note (2026-07-16):** the rules below marked ⚠️ **REMOVED** were deliberately deleted as non-functional or harmful. They still appear in the SPEC archive and in the pre-audit architecture spine. **Do not reintroduce them.**

## Technology Stack

> ⚠️ **Toolchain versions corrected 2026-07-19** (web-verified during Story 1.1 authoring, then folded into the spine). `ARCHITECTURE-SPINE.md#Stack` is now **in sync** with this table and carries the full trap list — either is canonical. See memlog entries 90–94.

**Pinned toolchain (do not drift):**

| Package             | Pin                                            | Why this exact value                                                                                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm`              | **11.15.1** (`packageManager: "pnpm@11.15.1"`) | Decision 2026-07-19 (was `9.x`).                                                                                                                                                                                                                                                                         |
| `typescript`        | **`~6.0.3`** (`>=6.0.3 <6.1.0`)                | 🔴 `latest` = 7.0.2 (the Go rewrite) ships **no Compiler API** until 7.1. `typescript-eslint@8.64.0` peers `typescript >=4.8.4 <6.1.0` → installing latest crashes ESLint. Use `~`, not an exact pin — a hard pin also blocks a future 6.0.4 patch. TS 7 installs side-by-side if you want `tsgo` speed. |
| `node` (`engines`)  | **`>=22.22.1`**                                | AD-8 says `>=22.13.0`, but `lint-staged@17.1.0` needs `>=22.22.1`. Stricter value satisfies both. Docker base stays `node:22-slim`.                                                                                                                                                                      |
| `eslint`            | 10.7.0                                         | eslintrc **fully removed**; flat config only; `--rulesdir` removed                                                                                                                                                                                                                                       |
| `typescript-eslint` | 8.64.0 (meta-package)                          | use `parserOptions.projectService: true`, **not** `project: [globs]`                                                                                                                                                                                                                                     |
| `prettier`          | 3.9.5                                          |                                                                                                                                                                                                                                                                                                          |
| `husky`             | 9.1.7                                          | `husky install` is **deprecated, not removed** (warns and still runs in 9.1.7; `add`/`set`/`uninstall` exit 1). Use `"prepare": "husky"` + `husky init`.                                                                                                                                                 |
| `lint-staged`       | 17.1.0                                         | not early 17.0.x (staging-bug regression); config in `package.json`, not `.lintstagedrc`                                                                                                                                                                                                                 |
| `vitest`            | 4.1.10                                         | `vitest.workspace.ts` **removed in v4** → `test.projects`                                                                                                                                                                                                                                                |
| Postgres (docker)   | `postgres:16.14-alpine`                        | bullseye is **frozen at `16.9-bullseye`**, not gone. The bare `postgres:16.14` tag moved to **trixie** — pinning it silently changes distro.                                                                                                                                                             |

**pnpm 11 migration footguns** — all settings move from `.npmrc` (now registry/auth only) into `pnpm-workspace.yaml`; the `pnpm` field in `package.json` is **silently ignored**, so `overrides` and `patchedDependencies` left there vanish with no warning; `onlyBuiltDependencies` → `allowBuilds`; two new install-breaking defaults: `minimumReleaseAge: 1440` and `blockExoticSubdeps: true`.

- Monorepo: pnpm workspaces (3 packages: `apps/api`, `apps/web`, `packages/shared`)
- Backend: NestJS 11.1.28 + `@mastra/nestjs` adapter + Drizzle ORM 0.45.2 + Postgres (Neon free). ⚠️ This file said **NestJS 10** until 2026-07-19; the spine and `architecture-spec.md` both pin **11.1.28** (web-verified during the architecture run). 11 is correct — do not revert.
- Frontend: Next.js 15 (App Router) + Tailwind + shadcn/ui + framer-motion
- Server state: TanStack Query v5 (query-keys factory in `apps/web/lib/queries.ts`)
- Client state: React Context (UUID, theme) + `useState` per-component + custom `useLocalStorage` hook — **no Zustand**
- Shared contracts: Zod schemas in `packages/shared/src/schemas.ts`
- Tests: Vitest (unit + integration + security) + Playwright with Page Object Model
- Deploy: Vercel (web) + Fly.io (API) + Neon (DB)

## Architecture Rules

**Hexagonal, strictly enforced:**

- `apps/api/src/domain/` MUST NOT import from `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, `node:fetch`. Pure logic over DTOs.
- All cross-boundary types are Zod-inferred DTOs, `Object.freeze`-wrapped at construction.
- Inbound boundary (HTTP): NestJS controllers use `ZodValidationPipe`.
- Outbound boundary (canonical adapter pattern): every adapter wraps raw I/O results in `Object.freeze(Schema.parse(raw))` before returning. Schema lives in `packages/shared/src/schemas.ts`. DTOs flow frozen into domain. Raw drizzle rows / HTTP bodies / LLM JSON never escape their adapter. See spine AD-3 for the canonical code pattern.
- LLM is untrusted: `safeParse` + 2 retries (best-effort) / 1 retry (strict-mode) + `UntrustedLlmOutputError` on final failure.
- Use-cases orchestrate ports + domain services. Domain services are pure functions.

**Mastra integration (critical):**

- `@mastra/nestjs`'s `MastraModule.register({mastra})` ships a catch-all `@All('*')` controller. **It MUST be imported last** in `AppModule` imports — otherwise it shadows every NestJS route.
- Node **`>= 22.22.1`** (pin in `package.json` `engines`) — Mastra's floor is `>= 22.13.0`, `lint-staged@17.1.0` raises it to `>= 22.22.1`; the stricter value satisfies both. See the pinned-toolchain table above.
- Use `@nestjs/platform-express` only (Mastra adapter does not support Fastify).
- Mastra model strings: `'provider/model'` format (e.g., `'minimax/MiniMax-M3'`).
- Docker base image **`node:22-slim`**. ⚠️ The archive + pre-audit spine say `node:20-slim` — that is **wrong and build-breaking** (fails the `>= 22.13.0` engines check, breaks Mastra in prod).

**Quiz generation flow (bounded critical path):**

- **Sync — all work needed to reach `status='ready'`:** `fetch → neutralize → chunk → select ~8k-token chunk budget → 1 structured LLM call (question pool) → validate pool → select categories → stratified-sample → persist → return`. Chunking stays sync — it is a _prerequisite_ for generation and costs milliseconds.
- **Question pool, not category pool (redesign 2026-07-19).** The one LLM call returns a pool of `ceil(questionCount × 1.5)` **category-tagged** questions. Category selection (4–6, clamped to what the pool contains) and the **stratified** even draw are **pure system-side steps after the call returns**. The superseded category-pool design needed a round trip between category proposal and question generation — i.e. two calls — which contradicted the single-call rule. ⚠️ **The draw must be stratified by category, never a naive random draw across the pool**, or per-category question counts skew and `avgRawScore` stops being comparable. All-or-nothing retry applies to the **pool**: if fewer than `questionCount` questions survive grounding validation, regenerate the whole pool — never partially accept.
- **Async — `void enrich(sessionId)` after the response is sent:** full document + chunk persistence, chat cache prefix, `knowledge_categories` aggregates, Langfuse flush. (Map-reduce was removed entirely — see FR-16; bounded critical path is one LLM call.)
- **No queue, no Redis, no BullMQ.**
- **Invariant:** enrichment is an **optimization, never a correctness dependency**. If Fly auto-stop kills it mid-flight, chat / gap-analysis finds no enrichment and computes on demand. Never write code that assumes enrichment ran.
- ⚠️ **Map-reduce must NEVER sit on the generation critical path** — that was the pre-audit design's timeout risk.
- **Generation is closed-world: NO Tavily / web search.** The only network call on the generation path is the single `ssrf-safe-fetch` of `sourceUrl` — that fetch _is_ the knowledge base. Tavily is confined to insight + chat, both post-quiz. The grounding check depends on this closed-world property.

## Scoring Rules (subtle invariants — do not revert)

- **Multi-answer:** `clamp(round(4 × (hits − misses) / |correct|, 2), 0, 4)` where `hits = |correct ∩ selected|`, `misses = |selected \ correct|`. **Wrong picks cancel right picks.**
  - Fully correct → 4 · partial → proportional · hit+miss → 0 · **select-all → 0** · empty → 0.
  - ⚠️ The archive + pre-audit spine say `4 × hits / |correct|`, which **ignored wrong selections** — selecting all 4 options scored **full marks on every `multiple` question**. That is a scoring-integrity defect, not an accepted trade-off. **Do not revert.**
- **Single:** 4 iff sets equal, else 0. `type='single'` requires exactly 1 correct; `multiple` requires 2..4. Validated at the LLM-output boundary.
- **Submissions must be complete** — exactly one response per session question, IDs matching the session set, else 400. This makes `weightedFinalScore`'s contiguous-position invariant hold by construction (previously undefined; would have thrown on a skipped question).
- 8-question geometric weights sum to **11.4358881**, not 12.
- Categories compare by `avgRawScore`, **not** `weightedScore` (position-biased, not comparable across categories).

**Ports (interfaces in `apps/api/src/domain/ports/`):**

- `LlmPort` — `generateQuiz`, `explainAnswer`, `analyzeGaps`, `chat`
- `DocumentRepositoryPort`, `QuizRepositoryPort`, `UserRepositoryPort`
- `WebSearchPort`, `IngestionPort`

## Security Rules

Treat as **release-blocking**:

1. **SSRF defense** (`HttpMarkdownAdapter` / `ssrf-safe-fetch`):
   - Scheme allowlist (`https:`/`http:`); block `file://`, `gopher://`, `ftp://`
   - Hostname blocklist: `localhost`, `0.0.0.0`, `metadata.google.internal`, `metadata.amazonaws.com`
   - IP literal parsing via `net.isIP()` (handles short-form: `127.1`, `0`, decimal)
   - **IPv4-mapped IPv6 normalization** (`::ffff:a.b.c.d` → `a.b.c.d` before RFC1918 check)
   - DNS-pin-then-validate against: RFC1918, loopback, link-local/IMDS, CGN `100.64/10`, Oracle `192.0.0/24`, benchmarking `198.18/15`, multicast, reserved, IPv6 loopback, IPv6 ULA `fc00::/7`, 6to4 `2002::/16`
   - Bind connect to validated IP (defeats DNS rebinding)
   - IDN homograph rejection (punycode check)
   - Reject HTTP/0.9 responses
   - Disable redirects; rewrite GitHub `blob` → `raw` before fetch
   - 10 MB HTTP body cap (defensive, prevents zip-bomb OOM); 2 MB decoded markdown cap; ~500 KB token-estimated cap (≈ 125k tokens); 10s timeout; `text/markdown`/`text/plain` only

2. **Per-endpoint ownership** (every `/sessions/:id/*` route, v1 four-layer enforcement 2026-07-19):
   - Validate `X-User-Id` is UUID v4 (Zod regex) in interceptor
   - `@OwnsSession()` interceptor `SET LOCAL app.user_id = '<uuid>'` per transaction
   - `@OwnsSession()` interceptor + app-layer `WHERE user_id = ?` on every session-scoped query
   - Return 404 (not 403) for both not-found and not-owned
   - **Postgres RLS as 4th layer (v1 default)**: function-based + `FORCE ROW LEVEL SECURITY`. Tables don't have `user_id` directly; policies use `EXISTS (SELECT 1 FROM quiz_sessions WHERE s.id = <table>.session_id AND s.user_id = current_session_user_id())`. **Mandatory:** every table needs `ENABLE` + `FORCE ROW LEVEL SECURITY` (Neon's table-owner role bypasses RLS without `FORCE`). See PRD §10.1 for the full pattern.
   - **Companion dev-time enforcement:** CI lint rule `@ai-quiz/no-unscoped-session-query` — fails the build if any `WHERE session_id = ?` clause appears outside a `forUser*` context or without an explicit `assertUserOwns(sessionId, userId)` call.
   - **Why both lint and RLS:** lint catches the failure mode at dev time (so it never gets to runtime); RLS catches at runtime if lint was bypassed (e.g. raw SQL outside ESLint's reach). Both are required. RLS is **NOT deferred to v2** — it's a v1 default.

3. **Chat-before-submit guard**: `POST /chat` while `status='ready'` strips question text + correct answers from LLM context (prevents answer-exfiltration).

3b. **Gap analysis via chat (no insight endpoint)** — FR-12 and FR-13 removed 2026-07-19. There is **no `POST /insight` endpoint**; gap analysis is delivered through the chat thread (FR-10) from the submit-time `topicsToStudy[]` + category aggregates, and the same `insights` object is loaded into the chat LLM context. The former `insight-requires-submit` 409 guard no longer applies; the chat-before-submit guard (rule 3) is the remaining answer-exfil control.

4. **Prompt injection defense**:
   - **Ingested markdown is inert data.** It is never executed. Only two surfaces let it act: the generator LLM (content integrity) and the chat tool loop (bounded: one read-only tool, ≤2 iterations, no secrets/PII/auth in context — accepted).
   - **Ingest neutralization (deterministic, no LLM):** only strips **genuine injection vectors**: `<script>` blocks, event handlers, iframes/embeds, `javascript:`/`data:text/html` URIs, control + zero-width + bidi chars (Trojan Source class), base64 blobs. **NFKC normalizes**. **Preserves HTML comments, link titles, alt text, and all other raw HTML** as legitimate quiz material. **Preserve code blocks** — highest-value quiz material.
   - **Never LLM-rewrite the source document** — a rewrite pass is itself injectable (same trust boundary, no new boundary), costs a doc pass on the critical path, and destroys the fidelity quizzes need (API names, flags, versions, code).
   - Trust-boundary prompt structure (`BEGIN_UNTRUSTED_DOCUMENT` / `END_UNTRUSTED_DOCUMENT` delimiters; system instructions repeated at end)
   - Document SHA-256 hashing at ingest
   - Tavily results summarized by a secondary LLM call to ≤200 chars before being added to main agent context (dual-LLM pattern)
   - ⚠️ **REMOVED — heuristic "ignore previous instructions" regex.** Theatre; replaced by neutralization + grounding.

5. **LLM output safety** — constrain shape, do not filter keywords:
   - Zod field length caps (`question.text.max(500)`, `explanation.max(2000)`, `chat.content.max(8_000)`)
   - **Structured output is the containment** — an injection saying "emit `<script>`" only puts a string in `question.text`; it cannot escape the schema.
   - **Question + answer text renders as PLAIN TEXT, never markdown/HTML** (`{text}` auto-escapes). This kills the XSS path at the source.
   - **DOMPurify scoped to explanations + chat only** (the only surfaces that genuinely need markdown), with `rel="noopener noreferrer"` on `target="_blank"`
   - **Grounding check** — reject questions with no meaningful token overlap against any source chunk. Catches injection _by its effect_, not by keyword.
   - **Secret-shaped-token check relative to source** — output matching `sk-[A-Za-z0-9]{20,}`, `AKIA…`, or long high-entropy strings **not present in the source doc** → retry.
   - `isRefusal()` graceful handling
   - ⚠️ **REMOVED — `outputLooksUnsafe()` keyword blocklist** (`api_key`, `password`, `DROP TABLE`, `<script>`, `javascript:`). It false-positived on exactly the DB/security READMEs this app targets — a quiz about SQL injection would be marked `failed` — while protecting nothing the controls above don't already cover. A quiz answer containing `DROP TABLE` is harmless when it renders as plain text and is grounded in the source.

6. **Identity spoofing mitigation**:
   - `X-User-Id` only. Validate UUID v4 at the boundary.
   - **Per-route rate limits keyed by BOTH `X-User-Id` and IP; stricter wins** (see rule 7). The IP key is the real control.
   - ⚠️ **REMOVED — HMAC binding (`X-User-Hmac` / `USER_HMAC_SECRET`).** The browser had to compute it, so the "secret" shipped client-side and any attacker forged valid HMACs as cheaply as the app. Zero security value + quarterly rotation that breaks live clients. (Rejected alternative: server-issued signed token — real security, but contradicts browser-generated UUID.)
   - ⚠️ **REMOVED — "5 req/sec/IP" fallback.** It was _looser_ than the 30/min per-user limit it backed (300/min vs 30/min), handing a UUID-rotating attacker a 10× budget increase.

7. **NestJS hardening**:
   - helmet with custom CSP, HSTS 2y + preload
   - CORS: exact `WEB_ORIGIN` **always**; `WEB_ORIGIN_REGEX` (Vercel previews) applies **only when `NODE_ENV !== 'production'`**. ⚠️ **REMOVED — the `x-vercel-environment: production` gate**: that header lives inside Vercel's runtime and is never present on a cross-origin browser request to Fly, so the check could not function.
   - Body limits: 100 KB JSON / urlencoded
   - `SafeExceptionFilter` (no stack traces in responses)
   - `@nestjs/throttler` v6 — **every route limited twice: once keyed by `X-User-Id`, once by IP, same table, stricter wins**. Global 30/min · `POST /sessions` 5/min · `POST /chat` 20/min. 429 + `Retry-After`. (No `POST /insight` — endpoint removed 2026-07-19.)
   - In-memory throttler store is accepted **only** with **`max_machines_running = 1`** — N machines silently multiply every limit by N.

8. **Postgres security**:
   - TLS required (`?sslmode=require` for Neon)
   - **RLS is v1 default (rule 2 has the full pattern)**. `FORCE ROW LEVEL SECURITY` is mandatory on every owned table — without `FORCE`, Neon's table-owner role bypasses RLS entirely. The `@OwnsSession()` interceptor sets `SET LOCAL app.user_id = '<uuid>'` per transaction (used by `current_session_user_id()`); RLS is the database-layer half of the 4-layer enforcement (interceptor → use-case ownership check → session-scoped queries → RLS).
   - `statement_timeout: 10_000`, `query_timeout: 15_000`
   - `UNIQUE (session_id, question_id)` on `user_responses`
   - Atomic state transition: `UPDATE quiz_sessions SET status='submitted' WHERE id=? AND status='ready' RETURNING ...`

9. **Observability privacy**:
   - `pino` redaction: deny-list with allowlist for safe fields. Redact `Authorization`, `x-api-key`, `cookie`, `x-user-id`, `req.body.*`, `*.apiKey`, all `*_KEY` env vars
   - Langfuse: trace metadata only; raw chat content scrubbed via cron after 7 days

## Testing Rules

- Vitest: unit tests for pure scoring/aggregation (in `packages/shared/test/`); integration tests in `apps/api/test/`; security suite in `apps/api/test/security/`
- Playwright: Page Object Model in `apps/web/e2e/pages/`; **all interactive elements get `data-testid`; tests use `getByTestId(...)` only**
- Every story must add or update tests for changed behavior
- Before completing a story: run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test && pnpm --filter @ai-quiz/web test:e2e`

## Tooling Rules (full config in spine `Consistency Conventions`)

- **ESLint flat config** at repo root. Mandatory custom rules: `@ai-quiz/no-unscoped-session-query` (catches `WHERE session_id = ?` outside a `forUser*` context — companion to the 4-layer ownership enforcement); `@ai-quiz/require-data-testid`; `@ai-quiz/no-console-log` outside `apps/api/src/adapters/`. TypeScript ESLint plugin for type-aware rules.
- **Prettier 3.x** at repo root (`.prettierrc`). Runs on pre-commit + pre-push + CI. Single source of formatting truth.
- **TypeScript strict** (`strict: true` + `noUncheckedIndexedAccess: true` + `noImplicitOverride: true`); `tsconfig.base.json` shared, per-package override.
- **`pnpm verify`** is the CI gate = `lint:check && typecheck && test && test:e2e && build`. **`lint:check` = `eslint . --max-warnings=0`** (defined 2026-07-19 — `verify` referenced it but no doc ever defined it; fail-on-warning, no autofix, correct for a gate). `format:check` is enforced by a `.husky/pre-push` hook rather than inside `verify`.
- **Custom ESLint rules ship with the code they guard, not all at once.** ESLint 10 removed `--rulesdir`, so they live as a plugin object in `packages/eslint-plugin-local/`. Story 1.1 builds the harness + `no-restricted-imports` only; `@ai-quiz/no-unscoped-session-query` lands in Story 1.4 with its fixtures; `@ai-quiz/require-data-testid` with the first UI stories. `@ai-quiz/no-console-log` needs **no custom rule** — built-in `no-console` with a path override outside `apps/api/src/adapters/` does it. A rule written against code that doesn't exist can't be tested.

## Workflow Rules

- Use BMAD full-flow (Analysis → Planning → Solutioning → Implementation) for cross-boundary changes
- Use `bmad-quick-dev` only for localized bug fixes / refactors
- Stories are created via `bmad-create-story`, implemented via `bmad-dev-story`, reviewed via `bmad-code-review`
- After each epic: `bmad-qa-generate-e2e-tests` + `bmad-retrospective`
- For test architecture: use TEA module — `test-design`, `test-review`, `nfr-assess`, `trace`

## Provider Defaults (verified July 2026)

- **Default LLM**: `minimax / MiniMax-M3` (user-specified; flagship; 1M context; auto caching only)
- **Provider rules (v1)**: MiniMax is the default (`minimax/MiniMax-M3`); OpenRouter free models are opt-in via the FE dropdown (filtered by `pricing.prompt = "0"`). Anthropic / OpenAI / Groq / Ollama deferred to v2. Anthropic reference kept for context only: `claude-sonnet-5` is current; `claude-sonnet-4-6` is now Legacy. `temperature`/`top_p` deprecated on Opus 4.7+ / Sonnet 5+ — capability map must omit them.
- **OpenAI**: avoid `gpt-4o`/`gpt-4-turbo`/`o1`/`o1-pro`/`o3-mini` — retire 2026-10-23
- **MiniMax**: model ID is `MiniMax-M3` (hyphen, not space); M3 supports auto caching only (no explicit `cache_control`); round-trip `reasoning_details` via `extra_body={"reasoning_split": true}` (OpenAI-compat) or full `content[]` array (Anthropic-compat)
