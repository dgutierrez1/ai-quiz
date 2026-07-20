# Story 2.3: Provider-agnostic LLM adapter + provider list endpoint

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to pick from the configured providers/models,
so that I can choose cost/quality per session without code changes.

## Acceptance Criteria

_(FR-4, FR-14, NFR-7, AD-6, AD-18)_

1. **Given** the `PROVIDER_CAPABILITIES` map, **Then** `MastraLlmAdapter` routes `'provider/model'` strings, **And** MiniMax is the default via inline `url` form, OpenRouter free via the built-in Mastra `openrouter` adapter.
2. **Given** MiniMax, **Then** the model id is `MiniMax-M3` (hyphen, not space), auto-caching only (no explicit `cache_control`), `reasoning_details` round-tripped, **And** `MINIMAX_REGION` switches host (`intl` → `api.minimax.io`; default `api.minimaxi.com`).
3. **Given** OpenRouter, **Then** models are filtered by `pricing.prompt = "0"` from the live `/api/v1/models?free=true` catalog, **And** a free-tier failure falls back to MiniMax-M3 transparently (single retry) **on the chat path only** — the fallback is **disabled on the generation path**, where the use-case is the sole retry authority (a mid-flight model swap changes the retry budget class and compounds toward ~6 LLM calls, blowing the ~30s sync ceiling). This story implements the fallback mechanism in the adapter and gates it by an explicit `allowFallback: boolean` parameter the caller controls — it does not implement the generation use-case itself (Story 2.4).
4. **Given** lazy loading, **Then** the default provider (MiniMax) loads eagerly and all other providers load via `await import(...)` inside `MastraLlmAdapter` on first use, **And** `/api/health` exposes `process.memoryUsage()` in non-prod (extending the existing sub-check list from Story 1.3, not rewriting the controller).
5. **Given** `GET /api/config/providers`, **Then** it returns only providers whose env keys are set (default-deny): `{minimax: [...], openrouter: [...free]}` when both `MINIMAX_API_KEY` and `OPENROUTER_API_KEY` are set, `{minimax: [...]}` when only MiniMax is set, `{}` when neither is set.
6. **Given** the OpenRouter live catalog fetch fails (network error or non-200), **Then** the endpoint degrades to MiniMax-only (or `{}` if `MINIMAX_API_KEY` is also unset) rather than returning 5xx.

### Additional acceptance criteria (derived from binding ADs and sibling-story seams — treat as equally required)

7. **Given** `apps/api/src/domain/ports/LlmPort.ts`, **Then** it defines `generateQuiz`, `explainAnswer`, `analyzeGaps`, `chat` method signatures (interfaces only — this story implements the port and a stub-level `MastraLlmAdapter`; the real bodies of `generateQuiz` land in Story 2.4, `chat` in Story 4.1/4.2, `explainAnswer`/`analyzeGaps` are folded into the submit/chat flow per FR-7/FR-10 and are not separate endpoints). Use-cases never import `adapters/llm/*` directly (AD-5) — this story's own health sub-check and the `GET /api/config/providers` controller call the adapter/capability matrix directly (driving layer), not through `LlmPort`, since neither is a domain use-case.
8. **Given** `apps/api/src/domain/*`, **Then** no file under it imports `mastra`, `@mastra/*`, `@nestjs/*`, `drizzle-orm`, `undici`, or `node:fetch` — `MastraLlmAdapter`, `capabilities.ts`, and the Mastra SDK imports live exclusively in `apps/api/src/adapters/llm/`.
9. **Given** `AppModule.imports`, **Then** `MastraModule.register({mastra})` is installed and appended as the **last** entry (AD-7), respecting the reserved-comment slot Story 1.3 left in place — no other change to import order.
10. **Given** the provider capability matrix, **Then** it lives in `apps/api/src/adapters/llm/capabilities.ts` as `PROVIDER_CAPABILITIES` and is the single source of truth every LLM call (this story's and later stories') must consult — it is not duplicated inline in the adapter or the controller.
11. **Given** the `.env.example` file (already created by Story 1.6 with DB/observability/CORS vars), **Then** this story appends `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_ANTHROPIC_URL`, `MINIMAX_MODELS`, `MINIMAX_REGION` (commented, `intl` example), `OPENROUTER_API_KEY` — with comments — and does **not** touch or reorder any existing lines.
12. **Given** `packages/shared/src/schemas.ts`, **Then** a `ProviderListResponseSchema` (or equivalent) Zod schema validates the shape returned by `GET /api/config/providers` at the adapter/controller boundary (AD-3) before it crosses to the HTTP response.
13. **Given** the Vitest suite, **Then** `apps/api/test/` covers: `capabilities.ts` matrix shape assertions, `GET /api/config/providers` default-deny branches (both keys set / only MiniMax / neither set), the OpenRouter-catalog-fetch-failure degrade-to-MiniMax-only path, lazy-import behavior (MiniMax SDK not imported until first call — assert via module-mock/spy, not by inspecting bundle output), and the chat-path-only fallback gate (`allowFallback: true` triggers a single MiniMax retry on OpenRouter failure; `allowFallback: false` propagates the error untouched); adapter coverage floor ≥60% (NFR-4/AD-N10).

## Tasks / Subtasks

- [ ] **Task 1 — Install Mastra + provider capability matrix** (AC: #1, #2, #3, #8, #10)
  - [ ] Install `mastra`, `@mastra/nestjs`, `@mastra/core` (or whatever the current Mastra package split requires — verify against the installed `mastra` version's actual export surface before wiring; do not assume package names from memory) and the OpenRouter provider dependency the built-in Mastra `openrouter` adapter needs.
  - [ ] Create `apps/api/src/adapters/llm/capabilities.ts` exporting `PROVIDER_CAPABILITIES`: a map keyed by provider (`minimax`, `openrouter`) with per-provider metadata — model id list source (static for MiniMax from `MINIMAX_MODELS` env, live-fetched for OpenRouter), auth env var name, retry budget class (`strict` = 1 retry for MiniMax, `best-effort` = 2 retries for OpenRouter — consumed by Story 2.4/4.2, not enforced here), caching mode (`auto` for MiniMax-M3), and whether `temperature`/`top_p` are supported (both `true` for MiniMax-M3 per spine AD-6; omit these params entirely for any future strict-mode-4.6+-style model — none exist in v1 scope, so this is a documented note, not code that branches on it).
  - [ ] Register MiniMax via Mastra's inline `url` provider form: `{id: 'minimax/MiniMax-M3', url: process.env.MINIMAX_REGION === 'intl' ? process.env.MINIMAX_INTL_BASE_URL : process.env.MINIMAX_BASE_URL, apiKey: process.env.MINIMAX_API_KEY}`. Do not register this as a built-in Mastra provider — it is not one.
  - [ ] Register OpenRouter via Mastra's built-in `openrouter` adapter, authenticated with `OPENROUTER_API_KEY`.
  - [ ] Do **not** register Anthropic, OpenAI, Groq, or Ollama providers — out of v1 scope per NFR-7/AD-6. If you are tempted to add one "for completeness" or "since Mastra supports it trivially," stop — this needs a PRD change, not a code change (see AGENTS.md "Stop and ask before" → "Adding a new provider outside the MiniMax + OpenRouter free scope").

- [ ] **Task 2 — `MastraLlmAdapter` skeleton + lazy loading** (AC: #1, #4, #8)
  - [ ] Create `apps/api/src/adapters/llm/MastraLlmAdapter.ts` implementing `LlmPort` (Task 3). This story stubs the method bodies with a `NotImplementedError`-style throw (or a minimal pass-through used only by this story's own tests) — the real `generateQuiz` logic is Story 2.4's, `chat` is Story 4.1/4.2's. What this story delivers is the **routing, lazy-load, and fallback plumbing** every later story's method body will call into.
  - [ ] Implement a private `resolveProvider(modelString: string)` helper that parses `'provider/model'`, looks up `PROVIDER_CAPABILITIES[provider]`, and lazy-`await import(...)`s the OpenRouter SDK/provider module on first use. MiniMax loads eagerly at adapter construction (it is the default; eager-loading the default keeps first-request latency low without eagerly loading the 150MB+ combined footprint of every SDK — AD-18).
  - [ ] Add a `providerModuleCache` (module-level `Map` or adapter-instance field) so a second call for the same provider does not re-`import()`.

- [ ] **Task 3 — `LlmPort` interface** (AC: #7, #8)
  - [ ] Create `apps/api/src/domain/ports/LlmPort.ts` — pure interface, zero I/O imports. Method signatures only (bodies are later stories' concern): `generateQuiz(params): Promise<QuestionPoolDto>`, `explainAnswer(params): Promise<string>`, `analyzeGaps(params): Promise<InsightDto>`, `chat(params): Promise<ChatResponseDto>`. Exact param/return DTO shapes are owned by the stories that implement each method (2.4, 4.1/4.2) — define them here only as `unknown`-free placeholders (e.g. reference-but-not-yet-created shared-schema types) if the DTOs don't exist yet; do not invent final shapes speculatively. If a DTO doesn't exist yet in `packages/shared/src/schemas.ts`, use a narrowly-scoped local type in the port file and leave a comment noting which story owns replacing it.
  - [ ] Confirm ESLint `no-restricted-imports` (Story 1.1) passes against this file — it must not import from `adapters/`, `driving/`, `mastra`, or any I/O library.

- [ ] **Task 4 — Chat-path-only fallback** (AC: #3, #13)
  - [ ] Implement fallback as an explicit parameter, not an implicit adapter-wide behavior: `MastraLlmAdapter`'s call surface accepts `{ allowFallback: boolean }` (or equivalent) per call. When `allowFallback: true` and the OpenRouter call fails, retry once against `minimax/MiniMax-M3` before propagating the error. When `allowFallback: false` (the generation path's setting, enforced by the Story 2.4 use-case calling with `allowFallback: false`), propagate the OpenRouter failure immediately — no swap.
  - [ ] This story does **not** wire `allowFallback` into a real `chat()` or `generateQuiz()` body (those don't exist yet) — it implements and unit-tests the fallback branch in isolation (e.g. against a minimal internal call helper), so Story 2.4 and Story 4.1/4.2 can each pass the correct static value when they build their real method bodies. Do not default `allowFallback` to `true` — an unset value must fail loudly (TypeScript required param, no default) so a future caller cannot accidentally enable fallback on the generation path by omission.

- [ ] **Task 5 — `GET /api/config/providers` endpoint** (AC: #5, #6, #12)
  - [ ] Create `apps/api/src/driving/config/config.controller.ts` (or `providers.controller.ts`) + `config.module.ts`. Route: `GET /api/config/providers` (resolves under the existing global `/api` prefix from Story 1.3 — `healthz` is the only excluded path).
  - [ ] Handler logic: default-deny. Build the response object incrementally — include `minimax: [...]` only if `process.env.MINIMAX_API_KEY` is set (models list from `PROVIDER_CAPABILITIES.minimax`, i.e. `MINIMAX_MODELS` env, comma-split); include `openrouter: [...]` only if `process.env.OPENROUTER_API_KEY` is set AND the live catalog fetch succeeds.
  - [ ] OpenRouter live catalog: fetch `https://openrouter.ai/api/v1/models?free=true` (or the full `/models` endpoint client-side-filtered by `pricing.prompt === "0"` if the `free=true` query param does not exist on the live API — verify against current OpenRouter docs rather than assuming; if verification is not possible in this environment, implement the `pricing.prompt === "0"` client-side filter as the primary mechanism since it is documented as authoritative in the spine, and treat the query param as an optimization only). On fetch failure (network error, timeout, or non-2xx), catch it and omit the `openrouter` key from the response entirely — never let the exception surface as a 5xx.
  - [ ] Add a short (e.g. 5 minute) in-memory cache for the OpenRouter live catalog fetch — this is a public, unauthenticated, rate-limited-only-by-the-global-throttler endpoint that will be polled by every landing-page load (Story 2.7); do not re-fetch OpenRouter on every request. Cache invalidation on process restart is acceptable (no persistence needed).
  - [ ] Response validated via `ProviderListResponseSchema.parse(...)` (Task 6) before returning — `Object.freeze` per AD-3's canonical adapter pattern, even though this is a driving-layer response rather than a repository read (the "parse at the boundary" rule applies to any raw external data — the OpenRouter HTTP response — crossing into your response shape).
  - [ ] This route is **not** session-scoped — no `@OwnsSession()`, no `X-User-Id` requirement. It is public config discovery. Do not add ownership checks; there is nothing to own.
  - [ ] Rate limiting: this route is covered automatically by Story 1.5's global `APP_GUARD` throttler (30/min per-user-and-per-IP) — **do not** add a `@Throttle()` override here; a dedicated stricter limit is not warranted for a cached, side-effect-free GET.

- [ ] **Task 6 — Shared Zod schema** (AC: #12)
  - [ ] In `packages/shared/src/schemas.ts`, add `ProviderListResponseSchema = z.object({ minimax: z.array(z.string()).optional(), openrouter: z.array(z.string()).optional() })` (or equivalent — keys present only when that provider is configured, per AC #5/#6). Do not make this `.strict()` in a way that would reject a future third key without a deliberate schema update — but do not add speculative keys for out-of-scope providers either.

- [ ] **Task 7 — `/api/health` provider sub-check extension** (AC: #4)
  - [ ] Read `apps/api/src/driving/health/health.controller.ts` (Story 1.3's file) completely before touching it. It already structures the deep check as a list of named sub-checks specifically so this story can append to it without rewriting the controller (Story 1.3 Design Ruling #4 / Task 5 note).
  - [ ] Add a `providers` sub-check entry: presence-check only (`MINIMAX_API_KEY` / `OPENROUTER_API_KEY` set or not) — **do not** make a live network call to MiniMax or OpenRouter from the health endpoint; that would turn a monitoring check into a dependency on two third-party APIs' uptime and defeats the purpose of a fast health probe. `/api/health`'s job per AD-20 is "deep-checks DB + provider reachability" at the _configuration_ level for this story; a live-ping sub-check is not required by any AC here and is explicitly out of scope — do not add one speculatively.
  - [ ] Add `process.memoryUsage()` to the `/api/health` response body, gated by `process.env.NODE_ENV !== 'production'` (AD-18) — this may already be a TODO/placeholder from Story 1.3; if the field doesn't exist yet, add it directly to the existing response-building code without restructuring the handler.

- [ ] **Task 8 — Env contract** (AC: #11)
  - [ ] Append to `.env.example` (do not reorder or touch existing DB/CORS/observability lines from Stories 1.3/1.5/1.6):
    ```
    # LLM providers — v1 scope is MiniMax (default) + OpenRouter free (opt-in) ONLY.
    # Groq / OpenAI / Anthropic / Ollama are deferred to v2 — do NOT add their keys.
    MINIMAX_API_KEY=
    MINIMAX_BASE_URL=https://api.minimaxi.com/v1
    MINIMAX_ANTHROPIC_URL=https://api.minimaxi.com/anthropic
    MINIMAX_MODELS=MiniMax-M3,MiniMax-M2.7,MiniMax-M2.7-highspeed
    # MINIMAX_REGION=intl   # switches host to api.minimax.io; default is mainland (api.minimaxi.com)
    OPENROUTER_API_KEY=    # enables the opt-in free tier; without it only MiniMax is offered
    ```
  - [ ] Do **not** add `TAVILY_API_KEY` here — that belongs to Story 4.2 (Tavily tool-calling), out of this story's scope even though it appears elsewhere in the full env contract.

- [ ] **Task 9 — Tests** (AC: #13)
  - [ ] `apps/api/test/adapters/llm/capabilities.test.ts` — matrix shape assertions (both providers present, correct retry-budget-class metadata, MiniMax model id is exactly `MiniMax-M3`).
  - [ ] `apps/api/test/adapters/llm/mastra-llm-adapter.test.ts` — lazy-load assertion (mock/spy the dynamic `import()`, assert OpenRouter's module is not imported until a call routes to it; assert MiniMax is available immediately after construction); fallback gate test (`allowFallback: true` → single MiniMax retry on simulated OpenRouter failure; `allowFallback: false` → error propagates untouched, no retry attempted).
  - [ ] `apps/api/test/driving/config/config.controller.test.ts` (integration) — all three default-deny branches from AC #5; OpenRouter-fetch-failure-degrades-to-MiniMax-only from AC #6 (mock the HTTP call); response shape validated against `ProviderListResponseSchema`; confirm no `X-User-Id` header is required (route resolves for an anonymous request).
  - [ ] `apps/api/test/driving/health/health.controller.test.ts` — extend Story 1.3's existing test file (do not create a duplicate) with a case asserting the `providers` sub-check appears and reflects env-var presence, and `memoryUsage` appears only when `NODE_ENV !== 'production'`.
  - [ ] Run the full gate before completing: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify`.

## Dev Notes

### Scope boundary — read this first

This story delivers the **routing substrate**: the capability matrix, the lazy-loading adapter shell, the fallback plumbing, the `LlmPort` interface, and the public provider-list endpoint. It does **not** generate a single real quiz question and does **not** implement a working chat turn. The following are explicitly **NOT** in scope here — implementing them in this story creates merge conflicts with agents working those stories concurrently:

| Do NOT build here                                                                                                                                                                                                                                                                                                       | Owned by                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Real `generateQuiz()` body: chunk selection, the single structured-output LLM call, pool validation, grounding check, secret-token check, retry-on-shortfall ladder                                                                                                                                                     | **Story 2.4**                                         |
| Category selection algorithm, stratified draw, feasibility search                                                                                                                                                                                                                                                       | **Story 2.5**                                         |
| Persisting the quiz, `status='ready'`/`failed` writes, `async enrich()`                                                                                                                                                                                                                                                 | **Story 2.6**                                         |
| Real `chat()` body: tool-execution loop, Tavily tool definition, dual-LLM summarization                                                                                                                                                                                                                                 | **Story 4.1 / 4.2**                                   |
| `explainAnswer()` / `analyzeGaps()` real bodies — these are folded into the submit response (FR-7) and chat context (FR-10) per the 2026-07-19 redesign; there is no standalone insight endpoint to implement                                                                                                           | **Story 3.1** (submit) / **Story 4.1** (chat context) |
| `POST /sessions` request validation, `strategy`/`questionCount` Zod schema, session creation                                                                                                                                                                                                                            | **Story 2.4**                                         |
| Ingest (`ssrf-safe-fetch`), neutralization, chunking                                                                                                                                                                                                                                                                    | **Stories 2.1, 2.2**                                  |
| Langfuse tracing of real LLM calls (the `TracingPort` interface itself already exists from Story 1.6 — this story's stub method bodies do not call it; the first story to make a real LLM call, Story 2.4, is responsible for wiring `TracingPort.recordGeneration(...)` around its call)                               | **Story 2.4** (generation), **Story 4.2** (chat)      |
| Landing-page provider dropdown UI that consumes `GET /api/config/providers`                                                                                                                                                                                                                                             | **Story 2.7**                                         |
| `provider`/`model` columns on `quiz_sessions` request validation (the columns exist in the Story 1.3 schema; the request-side Zod validation that a submitted `provider`/`model` pair is actually in the configured set is Story 2.4's `POST /sessions` validation, since this story's endpoint is read-only discovery) | **Story 2.4**                                         |

If you find yourself writing a prompt template, a Zod schema for `QuestionPoolDto`, or any code that calls `chunker.ts` or `ssrf-safe-fetch.ts`, stop — that belongs to a sibling story.

### Architecture compliance (binding)

- **AD-5 — `LlmPort` is the only outbound LLM boundary.** Use-cases (none exist yet that call this port — Story 2.4 is the first) must never import `adapters/llm/*` directly. This story's own driving-layer code (`config.controller.ts`, the `health.controller.ts` extension) is exempt from this rule — they call `capabilities.ts` / the adapter directly because they are driving-layer discovery/monitoring code, not domain use-cases orchestrating a generation flow. Do not create a use-case wrapper around `GET /api/config/providers` just to satisfy AD-5's letter — the rule exists to keep _domain_ use-cases from bypassing the port, and this endpoint has no domain use-case.
- **AD-6 — provider-agnostic via Mastra, v1 scope MiniMax + OpenRouter free only.** MiniMax is not a built-in Mastra provider — register via inline `url` form, never attempt to find a `mastra-provider-minimax` package that doesn't exist. OpenRouter uses Mastra's actual built-in adapter.
- **AD-6 — transparent fallback disabled on generation path.** This is the single most important behavioral rule in this story. Get the `allowFallback` gate wrong and Story 2.4's ~30s sync ceiling breaks in a way that is very hard to trace back to this story. The gate must be a required, explicit parameter — never a default.
- **AD-7 — Mastra catch-all must be last.** `MastraModule.register({mastra})` ships an `@All('*')` controller. Story 1.3 already left the reserved comment slot at the end of `AppModule.imports` — use it. If you register `ConfigModule` (Task 5) anywhere after `MastraModule`, every NestJS route including your own new `GET /api/config/providers` will 404.
- **AD-18 — lazy SDK loading.** The Fly free tier is a 256MB machine. Only MiniMax's SDK/client loads eagerly (it's the default and will be called on nearly every request in Epic 2+). OpenRouter's provider module must not be imported at module-load time — verify this with a spy-based test, not by reading the code and assuming; dynamic `import()` misuse (e.g. a top-level `import` statement disguised as conditional) is an easy mistake that only a runtime assertion catches.
- **AD-3 — Zod DTOs at every boundary.** The OpenRouter HTTP response is raw, untrusted external data. Parse + freeze it (or at minimum the derived `ProviderListResponseSchema` shape) before it crosses into your controller's response. Do not return the raw OpenRouter JSON shape directly, even filtered — return your own shape.
- **AD-2 — domain purity.** `LlmPort.ts` in `domain/ports/` must have zero imports from `mastra`, `@nestjs/*`, `drizzle-orm`, `undici`, `node:fetch`. If the Mastra SDK exports types you're tempted to import into the port for the DTO shapes, don't — define your own minimal interface in the port file instead.

### Design rulings made here (spec was silent — follow these)

1. **`allowFallback` is a required boolean parameter, not a config flag or adapter constructor option.** The spec (AD-6) states fallback applies "on the chat path only" and is "disabled on the generation path" — but doesn't specify the mechanism. A per-call required parameter (vs. e.g. checking `context.path === 'chat'` inside the adapter, or a Nest request-scoped flag) is chosen because it makes the caller's intent explicit at every call site and fails to compile/type-check if omitted, rather than silently defaulting to the wrong behavior. This is deliberately more explicit than "smart" inference from context.
2. **Health endpoint's `providers` sub-check is presence-only, not live-ping.** AD-20 says `/api/health` "deep-checks DB + provider reachability." Read literally this could mean pinging MiniMax/OpenRouter's API on every health check. Ruling: presence-check only (env var set or not). Rationale: (a) it keeps `/api/health` fast and free of third-party dependency risk — a MiniMax outage should not make your own health endpoint report unhealthy; (b) no AC in this story or any prior story asks for a live ping; (c) real reachability is proven the first time a real LLM call succeeds (Story 2.4's generation flow), which is a better signal than a synthetic ping anyway. If a future story wants live-ping health, that is a new AC, not an implicit extension of this one.
3. **OpenRouter catalog is cached in-memory for ~5 minutes, not fetched per-request.** Not specified by any source doc. Ruling: since `GET /api/config/providers` will be hit by every landing-page load (Story 2.7) and is public/unauthenticated, an unbounded per-request live fetch to a third party is both slow (adds OpenRouter's round-trip to every page load) and a needless dependency surface. A short TTL cache, invalidated on process restart, balances freshness (the catalog "may rotate" per the spine) against load.
4. **`LlmPort` method bodies in `MastraLlmAdapter` are stubs in this story.** The port interface and adapter _class_ must exist and compile (so Story 2.4/4.1/4.2 can implement against a real, typed target), but the actual `generateQuiz`/`chat`/etc. logic is empty/throwing. This is a deliberate scope cut, not an oversight — building real generation logic here would duplicate Story 2.4's ~15-item scope and risk exactly the "one story does everything, a bug hides inside it" failure mode the epics doc explicitly split 2.4/2.5/2.6 apart to avoid (see epics.md Story 2.4's "Split note").

### File Structure Contract

All paths are NEW except the two explicitly marked UPDATE (both from Story 1.3/1.6, being extended per their own reserved-extension-point design).

```
apps/api/
  src/
    domain/
      ports/
        LlmPort.ts                          # NEW — interface only, pure
    adapters/
      llm/
        capabilities.ts                     # NEW — PROVIDER_CAPABILITIES map
        MastraLlmAdapter.ts                 # NEW — implements LlmPort, lazy load, fallback gate
        providers/                          # NEW — dir for provider-specific wiring if capabilities.ts grows large; optional, inline in capabilities.ts is acceptable for v1's 2-provider scope
    driving/
      config/
        config.controller.ts                # NEW — GET /api/config/providers
        config.module.ts                    # NEW
      health/
        health.controller.ts                # UPDATE (Story 1.3) — append providers sub-check + memoryUsage
    app.module.ts                           # UPDATE (Story 1.3 reserved slot) — MastraModule.register(...) appended last, ConfigModule (Task 5) registered before it
  test/
    adapters/llm/
      capabilities.test.ts                  # NEW
      mastra-llm-adapter.test.ts            # NEW
    driving/
      config/config.controller.test.ts      # NEW
      health/health.controller.test.ts      # UPDATE (Story 1.3)
packages/shared/src/schemas.ts              # UPDATE — ADD ProviderListResponseSchema
.env.example                                # UPDATE (Story 1.6) — APPEND MiniMax/OpenRouter vars only
```

Naming conventions (spine Consistency Conventions, already established by Stories 1.1–1.6): kebab-case files, PascalCase classes, camelCase vars, `*.port.ts`-style suffix is used loosely in the spine's own source tree (`LlmPort.ts` — note the spine's minimal-source-tree listing uses PascalCase filenames for ports/adapters, e.g. `LlmPort.ts`, `MastraLlmAdapter.ts`, which this story follows exactly to stay consistent with that reference tree, even though it varies from the kebab-case-files convention stated elsewhere — this is not a variance you introduce, it is copying the spine's own literal file list).

### Library & Version Contract

Mastra is not yet installed anywhere in this greenfield repo — Story 1.3 explicitly deferred it. **Verify the current Mastra package split and version at implementation time** — the spine's stack table does not pin an exact Mastra version, and the package may have been restructured (`mastra` vs `@mastra/core` vs `@mastra/nestjs` vs a provider-specific package for OpenRouter) since this story was written. Do not guess; check the installed `package.json` of a fresh `pnpm add mastra @mastra/nestjs` or consult Mastra's current docs before writing import paths. This is the one significant "verify before coding" item in this story — everything else (MiniMax's inline `url` form, OpenRouter's built-in adapter, model ID `MiniMax-M3`) is spine-verified as of 2026-07-19 and safe to use as written.

| Package                                      | Version                               | Note                                                                                     |
| -------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `mastra` / `@mastra/core` / `@mastra/nestjs` | latest compatible with NestJS 11.1.28 | **Verify exact package names/versions at install time** — not yet installed in this repo |
| Node                                         | **`>= 22.22.1`**                      | Already pinned (Story 1.3)                                                               |
| `zod`                                        | `4.4.3`                               | Already pinned (Story 1.2/1.3)                                                           |
| `vitest`                                     | `4.1.10`                              | Already pinned                                                                           |

This story does **not** need MiniMax's or OpenRouter's own HTTP SDKs beyond what Mastra's inline `url` form and built-in `openrouter` adapter require — no separate `openai`-compat client library, since Mastra abstracts that.

### Testing Requirements

- **Framework:** Vitest (`4.1.10`). Integration tests in `apps/api/test/`, never colocated in `src/`.
- **Coverage floor:** adapters ≥60% (NFR-4/AD-N10) — this story's code is adapter- and driving-layer-heavy, budget for it explicitly.
- **No live network calls in CI.** Mock the OpenRouter HTTP fetch and the dynamic `import()` in all tests. The "OpenRouter live catalog" tests assert against a mocked response, not `openrouter.ai` itself.
- **Lazy-load assertions must be behavioral, not structural.** Don't just check that the code _contains_ `await import(...)` syntactically — spy/mock the module resolution and assert it is not called until a routing decision requires it. A structural check (grep for `import(`) would pass even if the import were accidentally hoisted or eagerly resolved elsewhere.
- Before completing: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify` (`lint:check && typecheck && test && test:e2e && build`).

### Anti-pattern watchlist

- ❌ Implementing real `generateQuiz()` logic "since I'm already in the adapter" → collides with Story 2.4, which owns chunk selection, the structured-output call, pool validation, and the retry ladder as one coherent, carefully-sequenced unit (see its "Split note" in epics.md — this exact kind of scope creep is what caused a refuted rule to survive undetected in the pre-split version of this work).
- ❌ Registering Anthropic/OpenAI/Groq/Ollama in `capabilities.ts` "since Mastra makes it easy" → out of v1 scope (NFR-7); requires a PRD change per AGENTS.md.
- ❌ Making `/api/health`'s provider sub-check a live ping to MiniMax/OpenRouter → couples your own health endpoint's uptime to two third parties' uptime; not asked for by any AC.
- ❌ Defaulting `allowFallback` to `true` "to be safe" → the generation path (Story 2.4) depends on this being `false` there; a default masks the omission instead of failing loudly.
- ❌ Eagerly importing the OpenRouter provider module at the top of `MastraLlmAdapter.ts` → defeats AD-18's entire purpose; the 256MB Fly machine is the real constraint, not a style preference.
- ❌ Registering `MastraModule` anywhere but last in `AppModule.imports` → every route including your own new controller silently 404s.
- ❌ Returning the raw OpenRouter catalog JSON (even filtered) instead of your own `ProviderListResponseSchema` shape → violates AD-3's "parse at the boundary" rule and couples your response contract to OpenRouter's wire format.
- ❌ Adding `TAVILY_API_KEY`, Anthropic keys, or any v2-deferred provider key to `.env.example` → out of scope; Story 4.2 owns Tavily.
- ❌ Requiring `X-User-Id` or adding `@OwnsSession()` to `GET /api/config/providers` → this is public, unauthenticated config discovery, not a session-scoped resource.

### Project Structure Notes

- Aligns with spine "Minimal source tree" (`adapters/llm/{capabilities.ts, MastraLlmAdapter.ts, providers/}`, `domain/ports/LlmPort.ts`, `driving/config/`) verbatim.
- Build-order position: step 6 (Mastra LLM adapter) of the 17-step build order in architecture-spec.md §A.13, immediately following step 5 (ingestion adapters, Stories 2.1/2.2, built concurrently) and preceding step 7 (`LlmPort` implementations' real bodies — Story 2.4).
- **Previous-story intelligence:** Story 1.3 built the two-health-endpoint skeleton and explicitly structured `/api/health`'s deep check as "a list of named sub-checks so Story 2.3 can append provider reachability without rewriting the controller" — this is a direct, deliberate handoff to this story; read `apps/api/src/driving/health/health.controller.ts` in full before touching it (do not skim). Story 1.6 built `TracingPort`/`LangfuseAdapter` and explicitly deferred real LLM-call tracing to this epic's stories (2.4, 4.2) — this story does not need to wire tracing since it makes no real LLM calls itself, but should not accidentally claim to in any comment or doc. Story 1.6 also created `.env.example` with the DB/CORS/observability contract this story appends to.
- **No git history to inherit** — no implementation code exists yet in the repo (confirmed via `_bmad-output/implementation-artifacts/` listing: only Epic 1 story _files_, i.e. planning artifacts, exist; `apps/`, `packages/` are unscaffolded per AGENTS.md "Current state"). Stories 1.1–1.6 and the rest of Epic 2 (2.1, 2.2, 2.4–2.7) are being authored/implemented concurrently by other agents — if `packages/shared/src/schemas.ts`, `apps/api/src/app.module.ts`, or `.env.example` do not yet exist or differ from what's described here when you start, treat their actual current state as authoritative and integrate rather than overwrite.
- No UX design contract applies — this story has no UI surface (Story 2.7 consumes this endpoint from the landing page).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.3-Provider-agnostic-LLM-adapter--provider-list-endpoint] — the six base ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-2-Generate-a-grounded-quiz-from-any-URL] — epic boundary note (generation ends at `status='ready'`; this story is infra beneath that)
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.4] — "Split note" explaining why 2.4/2.5/2.6 are separate from this story and from each other
- [Source: .../ARCHITECTURE-SPINE.md#AD-5] — LlmPort is the only outbound LLM boundary
- [Source: .../ARCHITECTURE-SPINE.md#AD-6] — provider-agnostic via Mastra, v1 scope, transparent-fallback-disabled-on-generation rule, env contract, default-deny filtering
- [Source: .../ARCHITECTURE-SPINE.md#AD-7] — Mastra catch-all must be last
- [Source: .../ARCHITECTURE-SPINE.md#AD-18] — lazy SDK loading, `/api/health` memoryUsage in non-prod
- [Source: .../ARCHITECTURE-SPINE.md#AD-20] — two health endpoints, `/api/health` deep-checks DB + providers
- [Source: .../ARCHITECTURE-SPINE.md#AD-3] — parse+freeze at boundaries
- [Source: .../ARCHITECTURE-SPINE.md#Minimal-source-tree] — `adapters/llm/`, `driving/config/`, `domain/ports/LlmPort.ts` paths
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-4] — provider-agnostic LLM adapter
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-14] — provider list endpoint
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#NFR-7-·-10.7-Provider-Rules] — v1 scope, MiniMax/OpenRouter details, fallback caveat, env contract
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.2-Mastra-Integration] — Mastra wiring, model strings, custom-provider registration
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.6-REST-API] — `GET /api/config/providers` route table entry
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.8-Prompt-Caching] — provider capability matrix table (caching mode per provider)
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.10-Environment] — MiniMax/OpenRouter env var names and defaults
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.13-Build-Order] — step 6
- [Source: _bmad-output/project-context.md#Provider-Defaults] — v1 provider scope, model ID correctness note
- [Source: _bmad-output/implementation-artifacts/1-3-api-skeleton-db-foundation-and-health-endpoints.md#Task-5] — health controller sub-check extension point (this story's direct dependency)
- [Source: _bmad-output/implementation-artifacts/1-3-api-skeleton-db-foundation-and-health-endpoints.md#Dev-Notes] — "Mastra install/registration, LLM adapter, GET /api/config/providers, provider sub-check in /api/health" explicitly deferred to Epic 2 by Story 1.3's scope-boundary table
- [Source: _bmad-output/implementation-artifacts/1-6-observability-and-deploy-the-skeleton.md#Dev-Notes] — `TracingPort`/Langfuse deferral to Stories 2.4/4.2; `.env.example` ownership
- [Source: _bmad-output/implementation-artifacts/1-5-network-hardening-rate-limiting-cors-helmet-error-shape.md] — global `APP_GUARD` throttler already covers this story's new route; `@SkipThrottle()` precedent for `/healthz` (not applicable here, but establishes the pattern for future stories)
- [Source: AGENTS.md#Stop-and-ask-before] — "Changing the provider list or default model" / "Adding a new provider outside the MiniMax + OpenRouter free scope"

### Open questions / spec gaps (non-blocking — flagged for the human)

1. **Exact Mastra package names/versions are unverified.** No source document in this repo pins an exact Mastra npm package split (`mastra` vs `@mastra/core` vs `@mastra/nestjs`) or version compatible with NestJS 11.1.28. The spine's Stack table lists "Backend: NestJS 11.1.28 + `@mastra/nestjs` adapter" but does not pin a Mastra version the way it pins `drizzle-orm 0.45.2` or `zod 4.4.3`. Flagged in Task 1/Library Contract as a "verify before coding" item — this is a real gap, not an oversight in this story file.
2. **OpenRouter's exact live-catalog query semantics (`?free=true` vs. client-side `pricing.prompt === "0"` filter) are stated slightly differently across source docs.** The spine says "capability matrix filters OpenRouter models by `pricing.prompt = "0"`" and separately "pulls live list from `https://openrouter.ai/api/v1/models?free=true`" — implying the `free=true` query param might already do the filtering server-side, making the client-side filter redundant-but-safe. Task 5 handles this by treating the client-side filter as authoritative and the query param as an optimization, which is safe either way, but the dev agent should verify OpenRouter's actual API behavior at implementation time rather than assume.
3. **`LlmPort` DTO shapes are necessarily provisional.** Since `QuestionPoolDto`, `InsightDto`, `ChatResponseDto` etc. don't exist in `packages/shared/src/schemas.ts` yet (they're created by Stories 2.4, 3.1, 4.1), this story's `LlmPort.ts` interface will use locally-scoped placeholder types. Story 2.4 (the first real consumer) should be expected to adjust the `generateQuiz` signature when it lands — this is a known, accepted seam, not a defect to avoid.
4. **Whether `MastraLlmAdapter`'s stub method bodies should throw or return an empty/placeholder value is not specified by any source doc.** This story rules: throw (e.g. a clearly-named `NotYetImplementedError` or similar), never return a silently-wrong placeholder value, so that any accidental early call from a future story surfaces immediately as a loud failure rather than a confusing empty result.

## Dev Agent Record

### Agent Model Used

_(to be filled by the dev agent)_

### Debug Log References

### Completion Notes List

### File List
