# ai-quiz

An AI agent that turns any public Markdown document into an interactive multiple-choice quiz, grades it against a geometric-weighted rubric, and then chats with the user about the knowledge areas they were weakest in.

This repository is a **pnpm-workspace monorepo** built on a hexagonal architecture (NestJS + Drizzle + Mastra on the API, Next.js on the web, Zod schemas + pure scoring in `packages/shared`).

## Quick start

```bash
# 1. Install deps (Node >=22.22.1 required)
pnpm install

# 2. Spin up local Postgres 16
docker compose up -d

# 3. Apply migrations
pnpm db:migrate

# 4. Run the API and web app together
pnpm dev
```

The web app serves on `http://localhost:3000` and the API on `http://localhost:4000`.

To run the full verification gate:

```bash
pnpm verify   # lint:check && typecheck && test && test:e2e && build
```

`pnpm verify` needs local Postgres running, but **does not need any LLM provider key** — the deterministic mock path covers every gated test.

## Layout

```
apps/
  api/      NestJS + Mastra + Drizzle (apps/api/src/{domain,adapters,driving})
  web/      Next.js (App Router)
packages/
  shared/   Zod schemas + scoring (pure, no I/O)
  eslint-plugin-local/  Internal ESLint plugin for project-specific rules
```

The API is strictly hexagonal: `apps/api/src/domain/` is pure and may not import `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, or `node:fetch`. ESLint enforces this — if the rule fires, the fix is to move the file, never to relax the rule.

## Environment variables

Copy `.env.example` to `.env`. Never commit real secrets.

| Variable               | Required          | Purpose                                                                             |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`         | yes               | Postgres connection string. Non-local hosts must carry `sslmode=require`.           |
| `API_PORT`             | no (default 4000) | API listen port.                                                                    |
| `NODE_ENV`             | yes               | `development` / `test` / `production`. Gates the CORS regex and debug output.       |
| `WEB_ORIGIN`           | yes               | Exact CORS origin. Always allowed.                                                  |
| `WEB_ORIGIN_REGEX`     | no                | Extra CORS origins. **Honored only when `NODE_ENV !== 'production'`.**              |
| `MINIMAX_API_KEY`      | no                | Enables the default `minimax/MiniMax-M3` provider.                                  |
| `OPENROUTER_API_KEY`   | no                | Enables opt-in OpenRouter free models.                                              |
| `MAX_MACHINES_RUNNING` | yes in prod       | Must be `1`. The rate limiter is in-memory and is only correct on a single machine. |
| `FLY_APP_NAME`         | no                | Set in the Fly environment to enable the single-machine boot guard.                 |

With **no** provider keys set, `GET /api/config/providers` returns an empty list and the landing page disables Start with an explicit "no providers configured" state, rather than showing an empty dropdown behind a dead button.

## Scoring rules

Scoring lives in `packages/shared/src/scoring.ts` as pure functions with no I/O, and is covered at 100%.

- **Single-answer**: `4` if and only if the selected set equals the correct set, else `0`.
- **Multi-answer**: `clamp(round(4 × (hits − misses) / |correct|, 2), 0, 4)` where `hits = |correct ∩ selected|` and `misses = |selected \ correct|`.
  Wrong picks cancel right picks. This is deliberate: the earlier `4 × hits / |correct|` formula ignored wrong selections, so selecting all four options scored full marks on every `multiple` question. **Do not revert it.**
- **Final score**: `Σ(rawᵢ × wᵢ) / Σwᵢ` with geometric weights `1.0 × 1.1^(i-1)`. For 8 questions the weights sum to **11.4358881**, not 12.
- **Categories** compare by `avgRawScore`, never by `weightedScore` — the latter is position-biased and not comparable across categories. A category with zero questions is never emitted, which removes the `0/0 = NaN` path.
- **Strength thresholds**: `>= 3.0` strong, `>= 1.6 && < 3.0` mixed, `< 1.6` weak.
- **Submissions must be complete** — exactly one response per question, with the question-ID set matching the session's exactly, and at least one selected position per response. This makes the contiguous-position invariant hold by construction.

## Security posture

Release-blocking controls, all covered by the test suite:

- **SSRF defense on ingest.** Scheme allow-list; expanded IP blocklist (RFC1918, loopback, link-local/IMDS, CGN `100.64/10`, Oracle `192.0.0/24`, benchmarking `198.18/15`, multicast, reserved, IPv6 ULA, 6to4) with IPv4-mapped IPv6 normalization; DNS-pin-then-validate with the connection bound to the validated IP (defeats rebinding); redirects disabled; IDN homograph and HTTP/0.9 rejection; tiered size caps (10 MB wire / 2 MB decoded / ~500 KB token-estimated) enforced during streaming decode rather than trusted from `Content-Length`; 10 s timeout.
- **Four-layer per-session ownership.** (1) `X-User-Id` must be a UUID **v4** — validated in middleware before any DB query or transaction opens. (2) The identity interceptor upserts the user, resolves the internal `users.id`, opens the request transaction, and sets the `app.user_id` GUC via parameterized `set_config(..., true)`, propagated through `AsyncLocalStorage` so repositories share the same connection and transaction. (3) Every use-case calls `findByIdAndUserId` and every session-scoped query filters by `session_id`. (4) Postgres RLS with `ENABLE` **and** `FORCE ROW LEVEL SECURITY` on every owned table, using `EXISTS`-join policies through `quiz_sessions.user_id`.
  Cross-user and not-found are **both 404**, with identical bodies — a 403 would confirm the resource exists.
- **The GUC carries `users.id`, never the raw header.** `X-User-Id` is `users.external_id` (text, browser-generated) while `quiz_sessions.user_id` is a `uuid` FK. Setting the GUC from the header would compare mismatched identifiers and silently deny every row.
- **Ingest neutralization.** Deterministic and LLM-free. Strips only genuine injection vectors — `<script>`, event handlers, iframes/embeds, `javascript:` and `data:text/html` URIs, control/zero-width/bidi characters (the Trojan Source class), base64 blobs — and NFKC-normalizes. HTML comments, link titles, alt text, other raw HTML, and **code blocks are preserved** as legitimate quiz material. The source document is never LLM-rewritten: a rewrite pass is itself injectable and destroys quiz fidelity.
- **LLM output containment.** Structured output is the containment boundary. Question and answer text render as **plain text, never markdown or HTML**; DOMPurify is scoped to explanations and chat only. A grounding check rejects questions with no meaningful token overlap against the source chunks, and a secret-shaped-token check rejects output containing secrets absent from the source. There is deliberately **no keyword blocklist** — it false-positived on exactly the security and database READMEs this app targets.
- **Closed-world generation.** The only network call on the generation path is the single SSRF-safe fetch of the source URL. Tavily is confined to post-quiz chat. The grounding check depends on this property.
- **Chat answer-exfil guard.** While a session is `ready`, the chat LLM context omits question text and correct answers entirely.
- **Rate limiting.** Every route is limited twice — once keyed by `X-User-Id`, once by IP — and the stricter wins (global 30/min, `POST /sessions` 5/min, `POST /chat` 20/min), returning 429 with `Retry-After`. The IP key is the real control, since `X-User-Id` is forgeable. The in-memory store is only correct with `max_machines_running = 1`.
- **Transport and logging.** helmet with a custom CSP and HSTS (2y + preload); 100 KB body limits; a safe exception filter that returns `{error: {code, message, requestId}}` with no stack traces; pino redaction of `Authorization`, `x-api-key`, `cookie`, `x-user-id`, request bodies, and every `*_KEY` / `*_SECRET`. Logs carry a SHA-256 `user_id_hash`, never the raw identifier.

Identity is `X-User-Id` only — there is no HMAC binding. It was removed because the browser had to compute it, so the secret shipped client-side and forging was free. Spoofing is answered by the per-route IP-keyed rate limits.

## Testing

```bash
pnpm --filter @ai-quiz/shared test   # pure scoring + schema units
pnpm --filter @ai-quiz/api test      # integration + security suites (needs Postgres)
pnpm --filter @ai-quiz/web test:e2e  # Playwright, desktop + mobile projects
```

- Pure scoring and aggregation are unit-tested in `packages/shared/test/`.
- API integration and security suites live in `apps/api/test/`. RLS and `FORCE` behavior cannot be faked with mocks — those tests run against the real local Postgres as the table-owner role.
- E2E uses Playwright with a Page Object Model in `apps/web/e2e/pages/`. Every interactive element carries a `data-testid` and specs use `getByTestId(...)` only.
- Coverage floors: scoring ≥ 95%, use-cases ≥ 80%, adapters ≥ 60%.

## Deploy

Vercel (web) + Fly.io (API) + Neon (Postgres), all on free tiers.

- The API image is multi-stage on **`node:22-slim`**. Node 20 fails the `engines` check and breaks Mastra at runtime.
- Migrations run as the Fly `release_command` (`node dist/main.js migrate`), which exits without ever binding a port.
- **`max_machines_running = 1` is required, not incidental** — with N machines the per-machine rate-limit counters silently multiply every limit by N.
- Two health endpoints with different jobs: `/healthz` is process-alive only and touches nothing (Fly's healthcheck must not depend on a cold-suspended Neon, or Fly kill-loops the machine), while `/api/health` deep-checks the database and provider reachability.
- Fly's free tier has no `min_machines_running=1`, so an external cron pings `/healthz` every 4 minutes to keep the machine warm.

## Further reading

- [`_bmad-output/project-context.md`](./_bmad-output/project-context.md) — the implementation constitution.
- [`ARCHITECTURE-SPINE.md`](./_bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md) — architecture decisions and the toolchain trap table.
- [`prd.md`](./_bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md) — the canonical product spec.

## Toolchain

- Node `>=22.22.1` · pnpm `>=11`
- TypeScript `~6.0.3` (`>=6.0.3 <6.1.0`) — TS 7.0+ ships no Compiler API until 7.1 and breaks typescript-eslint
- ESLint 10.7.0 (flat config only; `--rulesdir` removed)
- Vitest 4.1.10 (uses `test.projects`; `vitest.workspace.ts` was removed in v4)
- Postgres `16.14-alpine` locally, Neon in production
