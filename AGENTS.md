# AI Quiz Agent — Agent Instructions

## Before any change

1. Read `_bmad-output/project-context.md` (the implementation constitution).
2. Read the **PRD** at `_bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md` — single BMAD canonical spec.
3. If a BMAD workflow applies, use the matching skill (e.g. `/bmad-create-story`, `/bmad-dev-story`). Don't re-derive decisions that BMAD workflows already produce.
4. For cross-boundary changes (API/DB/LLM/web), use a BMAD story workflow — never `bmad-quick-dev`.
5. If a change conflicts with the PRD or `project-context.md`, **stop and surface the conflict** to the user before proceeding.
6. ⚠️ Original `SPEC.md` is archived at `_bmad-output/archive/SPEC-2026-07-16.md`. It is **frozen, unmaintained, and NOT authoritative** — an adversarial audit on 2026-07-16 **superseded** several of its rules (multi-answer scoring, RLS, HMAC binding, `outputLooksUnsafe`, insight guard, IP rate-limit keying, CORS gate, `node:20`, gpt-oss provider label; map-reduce placement was also removed but is captured in a separate revision). Read it for history only; **never re-derive a rule from it**. On any conflict, the **PRD wins**.

## Current state (greenfield, planning)

- **No source code exists yet** in `apps/`, `packages/`, or `src/`. The repo is a planning artifact only.
- Monorepo structure is specified in `architecture-spec.md` §A.3 (not in the PRD itself — Addendum A is now a back-reference; original `SPEC.md` is archived and that path no longer exists at the repo root) but not yet scaffolded.
- ✅ **The architecture spine at `_bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md` is `status: final` (regenerated 2026-07-18 from audited inputs + 2026-07-19 updates).** It is the authoritative architecture contract; safe to build from.
- **Next step:** Run `/bmad-create-epics-and-stories` in a fresh chat to break the 16 active FRs into implementable stories. Until then, Phase 4 implementation cannot start.

## BMAD usage

- **Fresh chat per workflow** — BMAD workflows load `project-context.md`; context fills up quickly.
- 56 skills installed for both Claude Code (`.claude/skills/`) and opencode (`.agents/skills/` + `.opencode/commands/`).
- Memlog writes go through `uv run _bmad/scripts/memlog.py append ...` (never read the file back except on resume).
- Customization goes in `_bmad/custom/config.toml` (team, committed) or `_bmad/custom/config.user.toml` (personal, gitignored). Never edit `_bmad/config.toml` directly — installer overwrites it.

## Hexagonal architecture (non-negotiable)

- `apps/api/src/domain/` MUST NOT import from `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, `node:fetch`. Pure logic over DTOs.
- Cross-boundary types are Zod DTOs (`z.infer<typeof X>`), `Object.freeze`-wrapped.
- Inbound HTTP: `ZodValidationPipe`. Outbound LLM/DB/search/fetch: adapters wrap raw results in `Object.freeze(Schema.parse(raw))` before returning (canonical adapter pattern, see spine AD-3). Zod schemas in `packages/shared/src/schemas.ts` are the single source of truth — they validate (a) DB rows on read, (b) HTTP bodies on write, (c) LLM JSON on read.
- LLM is untrusted: `safeParse` + 2 retries (best-effort providers) / 1 retry (strict-mode) + `UntrustedLlmOutputError` on final failure.

## Mastra wiring (critical, easy to break)

- `MastraModule.register({mastra})` from `@mastra/nestjs` MUST be imported **last** in `AppModule` imports. It ships a catch-all `@All('*')` controller that shadows every other route otherwise.
- Node `>= 22.13.0` — pin in `package.json` `engines`. Docker base image is **`node:22-slim`**; the archive's `node:20-slim` is wrong and breaks Mastra at runtime.
- Use `@nestjs/platform-express` only — the NestJS adapter doesn't support Fastify.
- Mastra model strings: `'provider/model'` (e.g., `'minimax/MiniMax-M3'`). Provider resolution via env vars, not factory code.
- **v1 scope (2026-07-19):** MiniMax-M3 is the default. OpenRouter free models are opt-in via the FE dropdown. Anthropic / OpenAI / Groq / Ollama deferred to v2. See `Provider rules` section below.

## Quiz generation flow (bounded critical path)

- **Sync — everything needed to reach `status='ready'`:** `fetch → neutralize → chunk → select ~8k-token chunk budget → 1 structured LLM call → persist → return`. Chunking stays sync — it's a prerequisite for generation and costs milliseconds.
- **Async — `void enrich(sessionId)` after the response is sent:** full document + chunk persistence, chat cache prefix, `knowledge_categories` aggregates, Langfuse flush.
- **No queue. No Redis. No BullMQ.**
- **Invariant that makes this safe:** enrichment is an **optimization, never a correctness dependency**. If Fly auto-stop kills it mid-flight, chat / gap-analysis finds no enrichment and computes on demand. Never write code that assumes enrichment ran.
- **No map-reduce at all.** Map-reduce was removed 2026-07-16. Bounded critical path is one LLM call. If a doc exceeds the chosen model's context window, the doc-size guard returns `400 DOC_TOO_LARGE` with a hint to switch models (e.g. MiniMax-M3 supports 1M tokens). If a doc is too short for `questionCount`, return `400 DOC_TOO_SHORT` with a hint to reduce `questionCount`. Never pad with filler questions.

## Security (release-blocking — do not weaken)

> Revised by the 2026-07-16 audit. Where this conflicts with the SPEC archive, **this wins** — the archive is frozen and unmaintained.

- **SSRF** (`HttpMarkdownAdapter`): expanded IP blocklist — RFC1918 + CGN `100.64/10` + Oracle IMDS `192.0.0/24` + benchmarking `198.18/15` + multicast + reserved + IPv6 ULA + 6to4 + IPv4-mapped IPv6 normalization + IDN homograph + HTTP/0.9 rejection. DNS-pin-then-validate; bind undici `Agent` to validated IP; disable redirects; 10 MB cap; 10 s timeout.
- **Ownership (v1 decision 2026-07-19)**: every `/sessions/:id/*` route uses **four-layer enforcement** (v1 default — RLS is a v1 default per the spine regen, not a v2 deferral): (1) `@OwnsSession()` interceptor validates `X-User-Id` is UUID v4; (2) every use-case calls `sessionRepo.findByIdAndUserId(sessionId, userId)` and throws `NotFoundError` on no-match (returns **404**, not 403, to prevent existence leaks); (3) all session-scoped queries filter by `session_id` (child tables have no `user_id` column directly); (4) **Postgres RLS as the database-layer half** — function-based with `FORCE ROW LEVEL SECURITY` + `EXISTS`-join policies on `quiz_sessions.user_id`. The interceptor propagates `app.user_id` via **AsyncLocalStorage** so the use-case's Drizzle queries share the same connection + transaction. **Both lint rule and RLS are required** — neither alone is sufficient. See PRD §10.1 + spine AD-9 for the full pattern.
- **Chat before submit** strips question text + correct answers from the LLM context — prevents answer exfiltration.
- **Gap analysis via chat (no separate endpoint)**: FR-12 (per-question insight) and FR-13 (separate gap-analysis endpoint) were both removed 2026-07-19. Gap analysis is delivered through the chat thread (FR-10) since the chat LLM context includes the session's precomputed `topicsToStudy[]` and category aggregates. The Result page UI renders results + insights inline (single API call to `/submit` returns both).
- **Ingest neutralization** (untrusted markdown): deterministic + LLM-free. Only strips **genuine injection vectors** (Trojan Source chars, `<script>` blocks, event handlers, iframes/embeds, `javascript:`/`data:text/html` URIs, base64 blobs) and **NFKC normalizes**. **Preserves HTML comments, link titles, alt text, and all other raw HTML** as legitimate quiz material. **Preserve code blocks.** **Never LLM-rewrite the source doc** (a rewrite pass is itself injectable and destroys quiz fidelity).
- **LLM output safety**: structured output is the containment; **Q/A render as plain text, never markdown**; DOMPurify scoped to explanations + chat only; **grounding check** rejects questions with no token overlap against source chunks; secret-shaped-token check relative to source. **No keyword blocklist** — `outputLooksUnsafe` (`DROP TABLE`/`password`/`<script>`) was removed for false-positiving on the DB/security READMEs this app targets.
- **Generation is closed-world**: NO Tavily / web search on the quiz-generation path — only the single `ssrf-safe-fetch` of `sourceUrl`. Tavily is confined to chat. The grounding check depends on this.
- **Submit idempotency + inline results + insights** (2026-07-19): `POST /submit` returns `{finalScore, breakdown[], categoryBreakdown[], insights: {topicsToStudy[], weakCategories[], strengthByCategory}}` in one response. `UNIQUE(session_id, question_id)` on `user_responses`; atomic `UPDATE quiz_sessions SET status='submitted' WHERE id=? AND status='ready' RETURNING ...`. Concurrent submits return cached result.
- **No per-session cost budget** (2026-07-19): no `cost_spent` column, no per-session guard. Cost control via free-tier provider caps (MiniMax-M3 20 RPM / 1M TPM; OpenRouter free) + rate limits only.
- **Identity**: `X-User-Id` only. **HMAC binding was removed** — the browser had to compute it, so the secret shipped client-side and forging was free. **Do not reintroduce it.** Spoofing is answered by per-route IP-keyed rate limits.
- **Rate limits**: every route limited per-user **and** per-IP, same table, stricter wins. In-memory store **requires `max_machines_running = 1`**.
- **pino redaction**: deny-list with allowlist. Always redact `Authorization`, `x-api-key`, `cookie`, `x-user-id`, `req.body.*`, all `*_KEY` env vars.
- **CORS**: exact `WEB_ORIGIN` always; `WEB_ORIGIN_REGEX` only when `NODE_ENV !== 'production'`. (No `x-vercel-environment` check — that header never reaches Fly from a browser.)

## Scoring (math has subtle invariants)

- Multi-answer score = `clamp(round(4 × (hits − misses) / |correct|, 2), 0, 4)` where `hits = |correct ∩ selected|`, `misses = |selected \ correct|`. Full-correct → 4. Empty → 0. **Select-all → 0.** Throws on `n<=0`.
  - **Wrong picks cancel right picks.** Revised 2026-07-16: the old `4 × hits / |correct|` ignored wrong selections, so selecting all 4 options scored full marks on *every* `multiple` question. Do not revert.
- Single: `type='single'` requires exactly 1 correct; multi requires 2..4 correct. Validated at LLM-output boundary.
- **Submissions must be complete** — one response per question, IDs matching the session set, else 400. This is what makes `weightedFinalScore`'s contiguous-position invariant hold by construction.
- 8-question geometric weights sum to **11.4358881**, not 12.
- Categories use `avgRawScore` for comparison (not `weightedScore` — position-biased, not comparable across categories).
- Strength thresholds: `>=3.0` strong, `>=1.6 AND <3.0` mixed, `<1.6` weak. Boundaries are exclusive of overlap.

## Provider rules (verified 2026-07-19)

- **v1 scope:** MiniMax (default) + OpenRouter free models (opt-in). No other pay-as-you-go providers.
- **Default:** `minimax/MiniMax-M3` (user-specified; flagship; 1M context; auto caching only).
- **OpenRouter free models** (filtered by `pricing.prompt = "0"`): example model IDs `meta-llama/llama-3.3-70b-instruct:free`, `google/gemini-2.0-flash-exp:free`, `qwen/qwen-2.5-72b-instruct:free`. Free-tier calls fall back to MiniMax-M3 transparently on failure (single retry).
- **Anthropic:** `claude-sonnet-5` is the current default; `claude-sonnet-4-6` is now Legacy (still available, not recommended). `temperature`/`top_p` deprecated on Opus 4.7+ / Sonnet 5+ — capability map must omit them.
- **OpenAI:** avoid `gpt-4o`, `gpt-4-turbo`, `o1`, `o1-pro`, `o3-mini` — all retire 2026-10-23.
- **MiniMax specifics:** model ID `MiniMax-M3` (hyphen, not space). M3 supports **auto caching only** (no explicit `cache_control`). M2.x supports explicit. Round-trip `reasoning_details` (OpenAI-compat via `extra_body={"reasoning_split": true}`; Anthropic-compat via full `content[]` array including `thinking` + `signature` blocks).
- **Groq constraint:** structured output **cannot combine with streaming OR tool use**. Quiz-gen uses strict mode (no stream, no tools); chat uses text-only (no structured output).
- **MiniMax regional:** `MINIMAX_REGION=intl` switches to `api.minimax.io`; mainland China is default (`api.minimaxi.com`).
- **Per-session cost budget:** **REMOVED 2026-07-19** — no `cost_spent` column, no per-session guard. Cost control via free-tier provider caps + rate limits (§10.2) only.

## Frontend state

- **Server state**: TanStack Query v5. Query-keys factory in `apps/web/lib/queries.ts`.
- **Client state**: React Context (UUID, theme) + `useState` per-component + custom `useLocalStorage` hook.
- **No Zustand, no Redux** — overkill for this scope.
- UUID generated in `<head>` inline script **before** React hydrates (avoids first-request race).

## Testing discipline

- Pure scoring/aggregation → Vitest unit tests in `packages/shared/test/`.
- API integration + security → Vitest in `apps/api/test/`.
- E2E → Playwright + Page Object Model. `data-testid` on every interactive element; tests use `getByTestId(...)` only.
- Every BMAD story must update or add tests for changed behavior.

## Deployment

- Vercel (web) + Fly.io (API) + Neon (DB). Migrations run as `fly.toml release_command` (`node dist/main.js migrate`).
- **`max_machines_running = 1` is required, not incidental** — the in-memory rate limiter is only correct on a single machine; N machines silently multiply every limit by N.
- Fly free-tier caveat: `min_machines_running=1` is not available — use external cron pinging `/healthz` every 4 min to keep warm.
- Two health endpoints: `/healthz` (Fly, ~1 ms, process-alive only) vs `/api/health` (monitoring, deep-checks DB + providers).
- Provider SDKs dynamic-imported in `LlmAdapter` on first use — avoids 256 MB OOM on Fly free tier.

## Stop and ask before

- Changing the data model (adds/renames/drops columns or tables).
- Changing hexagonal boundaries (cross-domain imports).
- Changing security controls (SSRF blocklist, ownership checks, rate limits, ingest neutralization, grounding check).
- Reintroducing anything the 2026-07-16 audit removed (RLS, HMAC binding, `outputLooksUnsafe` keyword blocklist, web search during generation, per-question insight endpoint, LLM-proposed strategy, map-reduce on generation path).
- **Adding `user_id` columns to child tables** (`documents`, `questions`, `answers`, `user_responses`, `knowledge_categories`) — they intentionally don't have one; ownership flows via `quiz_sessions.user_id` joined by `session_id`. Adding them would denormalize the schema without security benefit (RLS removed anyway).
- **Weakening the `@OwnsSession()` interceptor pattern** — four-layer enforcement (interceptor validates → use-case ownership check → session-scoped queries → Postgres RLS) is the v1 ownership defense. Any new endpoint must follow the pattern or the CI lint rule `@ai-quiz/no-unscoped-session-query` will fail the build, AND the RLS policy will reject the query.
- **Disabling Postgres RLS or removing `FORCE ROW LEVEL SECURITY`** — without `FORCE`, the Neon table-owner role bypasses RLS entirely. RLS is a v1 default; disabling it = exposing the system to cross-user data leaks. The lint rule + RLS are both required.
- **Removing or bypassing the `@ai-quiz/no-unscoped-session-query` CI lint rule** — it's the deterministic enforcement on top of the 4-layer ownership pattern. Removing it puts us back to "review-only" enforcement.
- **Adding new tables without `ENABLE` + `FORCE ROW LEVEL SECURITY`** — every owned table must be RLS-enabled. New tables defaulting to "no RLS" is a security gap.
- Changing the provider list or default model.
- **Adding a new provider outside the MiniMax + OpenRouter free scope** — would need a PRD update.
- **Reintroducing the `$0.50/session` cost budget or any `cost_spent` column** — removed 2026-07-19.
- Adding a new deployment target or env var that affects production.
- Changing scoring formulas or weight sequences.
- **Reverting mobile to "desktop-only"** — mobile is a first-class surface per the 2026-07-19 resolution.
- **Reintroducing a separate insight endpoint** — gap analysis is delivered via chat (FR-10) with the `topicsToStudy[]` + category aggregates in the chat LLM context.

## Tooling (full config in spine `Consistency Conventions`)

- **ESLint flat config** with mandatory custom rule `@ai-quiz/no-unscoped-session-query` (catches `WHERE session_id = ?` outside a `forUser*` context).
- **Prettier 3.x**; format on pre-commit + pre-push + CI.
- **TypeScript strict** (`strict: true` + `noUncheckedIndexedAccess: true` + `noImplicitOverride: true`); `tsconfig.base.json` shared, per-package override.
- **`pnpm verify`** is the CI gate = `lint:check && typecheck && test && test:e2e && build`.
- For the full rules list + scripts: see `ARCHITECTURE-SPINE.md` → `Consistency Conventions` table.
