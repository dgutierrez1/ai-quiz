---
title: AI Quiz Agent
created: 2026-07-16
updated: 2026-07-16
status: draft
audited: 2026-07-16          # adversarial audit; 10 resolutions applied. See .memlog.md (Resolved Ambiguities section) and architecture-spec.md for implementation detail.
sources:
  - _bmad-output/project-context.md (constitution)
  - _bmad-output/planning-artifacts/specs/architecture-spec.md (temporary pre-implementation reference — implementation details formerly embedded in this PRD)
companions:
  - _bmad-output/project-context.md
historical_only:
  # NOT a companion. Frozen 2026-07-16, unmaintained, NOT authoritative.
  # The 2026-07-16 audit SUPERSEDED several of its rules (RLS, HMAC binding,
  # multi-answer scoring, outputLooksUnsafe, map-reduce placement, node:20).
  # Read for history only; never re-derive a rule from it. PRD wins on conflict.
  - _bmad-output/archive/SPEC-2026-07-16.md
---

# PRD: AI Quiz Agent

> Single BMAD canonical spec. Vision, JTBDs, UJs, FRs, and NFRs live here; implementation details are referenced via `_bmad-output/planning-artifacts/specs/architecture-spec.md` (a temporary pre-implementation reference). Downstream BMAD artifacts (architecture spine, epics, stories) can be generated from this PRD + that reference + `project-context.md`.
>
> Original detailed SPEC archived at `_bmad-output/archive/SPEC-2026-07-16.md` for deep reference. PRD supersedes it.

---

## 0. Document Purpose

This PRD scopes the v1 deliverable. Downstream readers:
- **Architect (BMM Winston)** — produces the architecture spine from this PRD + the implementation reference at `_bmad-output/planning-artifacts/specs/architecture-spec.md`.
- **Story creators / devs (BMM Amelia)** — implement stories against FRs.
- **Product team** — reviews v1 against this PRD before release.

Structured glossary-first; FRs numbered globally; SPEC archive referenced only for historical depth.

---

## 1. Vision

A **self-contained, production-shaped web app** that turns any publicly accessible Markdown document into an interactive comprehension session — generated questions grounded in the document, a graded response flow, and a persistent chat thread that supports per-question follow-up conversationally and surfaces the knowledge categories where the user is weakest. The user pastes a URL (e.g. a GitHub README), picks a strategy, the agent derives 6–10 candidate knowledge categories from the document, the system randomly selects 4–6 of them, and generates 5–8 questions evenly distributed across the selected set. The user responds in the web UI; the system grades the submission against a geometric-weighted rubric. After grading, the user can chat per-question (with `questionId` anchor) and request a whole-quiz gap analysis that ranks weak knowledge areas.

The product demonstrates an end-to-end **LLM agent system** that respects real engineering constraints: hexagonal boundaries, server-enforced per-session ownership, SSRF defense on user-supplied URLs, prompt-injection hardening, provider-agnostic model selection, and zero-cost deployment to Vercel + Fly.io + Neon free tiers.

---

## 2. Target User

### 2.1 Jobs To Be Done

- **Learn a new technical library efficiently.** Paste a GitHub README, get grounded questions and a graded session that surfaces what to study next.
- **Run the same engine on ≥ 2 different real-world READMEs** (e.g. pipecat, langchain, react) and have it produce sensible sessions from both — proving portability across source material.
- **Trust security boundaries.** Submit untrusted URLs (private networks, malicious inputs) and see the system refuse safely rather than execute.
- **Switch LLM providers live.** Pick from the configured provider/model dropdown and observe cost/quality trade-offs without code changes.

### 2.2 Non-Users (v1)

- **End-consumer learning platforms** — not a consumer product launch; no auth, no payments, no analytics.
- **Enterprise customers** — no SSO, no SLA, no compliance posture.
- **Non-English documents** — out of scope; UI + LLM prompts are English-only.

### 2.3 Key User Journeys

> Persona is **Sam, a developer** exploring a new technical library. They want fast, accurate comprehension check + the ability to ask follow-up questions grounded in the source.

> **Note:** The journeys below are user-facing flows only. Security probing, scoring-integrity probing, architecture review, etc. are testing/verification scenarios that belong in the test plan (§16.4 / Vitest security suite + Playwright E2E), not in user journeys.

- **UJ-1. Sam runs the canonical happy path.**
  - **Persona + context:** Sam is exploring Pipecat for the first time and wants a quick comprehension check on the README.
  - **Entry state:** Browser open, app reachable.
  - **Path:** pastes `https://raw.githubusercontent.com/pipecat-ai/pipecat/main/README.md` → picks `minimax/MiniMax-M3` (the only supported provider in v1) → clicks Start → answers all 8 questions → submits → sees score 2.8/4, category breakdown, "Explain Q3" button → opens chat panel → types "Why am I weak in Streaming?" → receives explanation with cited doc snippets.
  - **Climax:** chat response references the document accurately; Sam feels the system "understood" the README.
  - **Resolution:** Sam runs the same flow on `langchain/README.md` — the new session is sensible; history sidebar shows both.
  - **Edge case:** If generation fails, Sam sees a retry button, not a spinner.

- **UJ-2. Sam asks follow-up questions via chat (free text, decoupled from questions).**
  - **Persona + context:** After submitting, Sam wants to deepen understanding on a specific topic.
  - **Entry state:** Result page with score breakdown and chat panel open.
  - **Path:** Sam types a free-form message in the chat input: "Can you explain the WebSocket transport section in more detail?" → chat LLM responds with cited doc snippets and category-gap context (it has access to the gap analysis already computed for the session).
  - **Climax:** Chat response surfaces both the doc snippet AND Sam's weakness in "Streaming" category, without requiring a separate API call.
  - **Edge case:** Sam clicks "Explain Q3" on a specific question — chat input pre-fills with template `Explain question Q3 — I answered [incorrectly/correctly]: [user's selection]`; user can edit before sending.

- **UJ-3. Sam revisits an old session from history (mobile-friendly).**
  - **Persona + context:** Sam comes back a week later on their phone to review what they got wrong.
  - **Entry state:** Mobile browser, no authentication.
  - **Path:** Lands on `/` → history sidebar (collapses to a slide-out on mobile) shows prior sessions → taps one → loads `/result/[id]` (dual-panel layout collapses to tabs on mobile: results tab + chat tab) → scrolls chat (no pagination — chat shows latest N=50 messages, older ones archived client-side).
  - **Climax:** Sam can review their answers, category gaps, and chat history on a phone without losing context.
  - **Edge case:** If a session is `pending` from a previous attempt (e.g. browser crashed mid-gen), the status is preserved in DB and Sam can resume by clicking the history entry.

- **UJ-4. Sam analyzes gaps via chat (no separate insight endpoint).**
  - **Persona + context:** Sam wants to know which topics to study next.
  - **Entry state:** Result page, chat open.
  - **Path:** Sam types: "What should I study next?" → chat LLM uses the already-computed category gap analysis (from the same session context) to suggest topics — pulling from `topicsToStudy[]` that was persisted in the `insights` row at submit time.
  - **Climax:** Chat returns concrete suggestions ("You scored 1.5/4 on WebSockets; the doc section §3.2 covers retry semantics — re-read that"), all without a separate `POST /insight` round-trip.
  - **Why no separate endpoint:** chat LLM has access to all the same context (session, responses, gap analysis, category aggregates) that a dedicated insight endpoint would have. A separate endpoint would duplicate state and add round-trips.

---

## 3. Glossary

> Downstream workflows must use these terms verbatim. Source: SPEC archive §3, §4, §5.

- **Session** — A single quiz attempt from URL intake to final score. One user, one source URL, one lifecycle (`pending` → `ready` → `submitted`).
- **Question** — One quiz item. Has exactly 4 answer positions, type `single` or `multiple`, and a `category` (knowledge area).
- **Answer** — One of four options for a question. Has an `is_correct` flag — **never exposed to the FE before submit**.
- **Submission** — A user's complete set of `selected` answer positions for a session. Scored once; idempotent on retry.
- **Category** — An LLM-derived knowledge area tag on each question (e.g. "Streaming", "WebSockets"). Used for gap analysis; hidden during quiz.
- **Insight** — An AI-generated artifact produced post-submit: a whole-quiz `gap_analysis` that ranks the user's weak knowledge categories and suggests study topics. Persisted; revisitable. Per-question follow-up is conversational via chat (FR-10), not via an insight endpoint.
- **Chat message** — One turn in the persistent per-session chat thread. `user` or `assistant` role. May be anchored to a `questionId`.
- **Provider / Model** — The LLM backend the user selected for this session. Resolved by Mastra via env vars; user can swap per session via dropdown.
- **Strategy** — One of `factual | comprehension | mixed | trivia`. User-selectable per session; LLM may propose one if user omits.
- **Hexagonal architecture** — The backend's domain/ports/adapters split. Domain is pure; adapters own all I/O.
- **Ownership check** — The `@OwnsSession()` interceptor + app-layer `WHERE user_id = ?` on every session-scoped query. The sole ownership defense; returns 404 for both not-found and not-owned.
- **Document / Chunk** — The source markdown (`documents.content_markdown`) and its pre-chunked sections (`documents.chunks` JSONB array). Persisted; referenced by insight + chat flows.
- **Neutralization** — The deterministic, LLM-free scrub applied to ingested markdown. **Only strips genuine injection vectors** (`<script>`, event handlers, iframes/embeds, `javascript:`/`data:text/html` URIs, control + zero-width + bidi chars, base64 blobs) and **normalizes (NFKC)**. **Preserves HTML comments, link titles, image alt text, and all other raw HTML** — those are legitimate quiz material, not attack vectors. Code blocks are preserved.
- **Grounding check** — A question is rejected if its text + answers share no meaningful token overlap with any source chunk. Catches prompt injection **by its effect** rather than by keyword.
- **Critical path** — The synchronous work required to reach `status='ready'` so the user can start the quiz. Everything else is async enrichment.
- **Enrichment** — Post-response async work (full doc persistence, category aggregates). **Always an optimization, never a correctness dependency** — any consumer recomputes on demand if enrichment is absent. Map-reduce summarization was removed; see FR-16.

---

## 4. Features

> Behavioral description + FRs. FRs are numbered globally so downstream artifacts (epics, stories) cite them stably.
>
> **Archive-reference rule (post-audit 2026-07-16):** `Spec archive governs:` pointers are **historical context only, never authority**. Where a rule was changed by the audit, the archive is explicitly **superseded** and the binding rule is stated **inline here**. If the archive and this PRD disagree, **this PRD wins** — the archive is frozen at 2026-07-16 and is not maintained.

### 4.1 Quiz Generation

**Description:** User pastes a Markdown URL. The system fetches the document via SSRF-safe ingest, derives a strategy + 3–7 candidate categories, calls the LLM to generate 5–8 questions with structured output, validates + persists, returns the questions (without `is_correct`).

**Functional Requirements:**

#### FR-1: SSRF-safe markdown ingest
[System] can fetch arbitrary user-supplied Markdown URLs without exposing internal networks.
- Spec archive governs: §7.1, §11.2 (expanded IP blocklist, DNS-pin, IDN homograph, HTTP/0.9 rejection, **tiered size limits (10 MB HTTP body / 2 MB decoded markdown / ~500 KB token-estimated)**, 10s timeout, redirects off).
- **Consequences:** SSRF test suite in `apps/api/test/security/` covers RFC1918 × IPv4/IPv6, loopback, IMDS hostnames, all non-http(s) schemes, IDN homograph.

#### FR-2: Strategy (user-picked) + category selection (LLM-derived pool, random subset)
[System] requires a `strategy` from the user (no LLM proposal); derives a category pool from the document; **randomly selects N categories** from the pool; constrains question generation to that subset.
- **Strategy is REQUIRED** in `POST /sessions` (enum: `factual | comprehension | mixed | trivia`). The LLM uses it as a prompt modifier — `factual` emphasizes recall, `comprehension` emphasizes "why/how", `mixed` mixes types, `trivia` emphasizes unusual facts. No silent default; no LLM proposal.
- **Category pool:** LLM proposes 6–10 candidate categories from the document's headings/sections (single LLM call, deterministic per `(document, model)` so retries are stable).
- **Selection:** system **randomly picks 4–6** from the pool per quiz (configurable). Different runs of the same URL produce different category mixes — adds replay value.
- **Even distribution:** questions are spread **evenly** across the selected categories (e.g. 6 questions across 4 categories → 2-2-1-1).
- **Consequences:** Vitest covers (a) strategy enum is required (Zod), (b) selected category count is in [4,6], (c) selected categories are a subset of the LLM-derived pool, (d) question count per category differs by ≤ 1.

#### FR-3: LLM question generation (structured)
[System] can generate 5–8 questions with 4 answers each, type ∈ {`single`, `multiple`}, **category from the FR-2 randomly-selected subset**.
- Spec archive: §7.1 step 4-5, §4.5 (LLM untrusted), §10 (provider model strings).
- **Consequences:** Zod schema enforces exactly 4 answers, `single` requires **exactly 1** correct, `multiple` requires 2–4 correct, **category must be one of the selected subset** (Zod enum), questions distributed evenly across categories (FR-2). 2 retries for `jsonPromptInjection` providers, 1 retry for strict-mode (`minimax/MiniMax-M3`).

#### FR-15: Ingest neutralization + output grounding
[System] can use untrusted third-party markdown as quiz source material without letting it steer the model or reach the browser as markup.
- **Supersedes** spec archive §11.3 Layer 1 (heuristic regex) and §11.4 `outputLooksUnsafe` keyword blocklist — both **removed**, see rationale below.
- The ingested document is **inert data**. It is never executed. Exactly two surfaces let it act: (a) the generator LLM reads it (→ content integrity risk), and (b) the chat agent's tool loop could be steered into attacker-chosen `tavily_search` queries (→ accepted: one read-only tool, max 2 iterations, no secrets/PII/auth in context).
- **Do NOT LLM-rewrite the document.** A rewrite pass is itself injectable (same trust boundary, no new boundary), costs a full doc pass on the critical path, and destroys the fidelity quizzes need (exact API names, flags, versions, code).
- **Ingest-side (deterministic, no LLM):** only strips **genuine injection vectors** and normalizes. Everything else is preserved as potential quiz material.
  1. **Cleanliness (no info loss):** **NFKC normalize** (prevents Unicode normalization attacks; doesn't change visible text). **Strip C0/C1 control characters** (other than `\t \n \r`).
  2. **Trojan Source class (real attack vector):** strip zero-width characters (U+200B, U+200C, U+200D, U+FEFF, etc.) and bidi control characters (U+202A–U+202E, U+2066–U+2069). These have zero quiz value and are the documented Trojan Source attack.
  3. **Active-content vectors (real attack vector):** strip `<script>` blocks, event handlers (`onclick=`, `onerror=`, `onload=`, etc.), `<iframe>` / `<frame>` / `<object>` / `<embed>` / `<applet>`, `<meta http-equiv="refresh">` / `<meta http-equiv="set-cookie">`, and any URL with scheme `javascript:` or `data:text/html` in `href` / `src`.
  4. **Binary blobs (no quiz value):** strip data-URI base64 blobs (`data:image/...;base64,...`, `data:application/pdf;base64,...`) — large, opaque to the LLM.
  - **Preserved as quiz material:** HTML comments (`<!-- ... -->`), link titles (`title="..."`), image alt text (`alt="..."`), all other raw HTML formatting (`<kbd>`, `<sup>`, `<sub>`, `<details>`, etc.), inline markdown, list/table syntax. **Preserve code blocks** — highest-value quiz material.
- **Output-side — constrain shape, don't filter keywords:**
  1. **Structured output is the containment.** An injection saying "emit `<script>`" only puts a string in `question.text`; it cannot escape the Zod schema.
  2. **Question + answer text renders as plain text, never markdown/HTML** (`{text}` auto-escapes). DOMPurify is scoped to explanations + chat only.
  3. **Grounding check** — reject questions with no meaningful token overlap against any source chunk.
  4. **Secret-shaped-token check relative to source** — output matching `sk-[A-Za-z0-9]{20,}`, `AKIA…`, or long high-entropy strings **not present in the source doc** → retry. Replaces the `DROP TABLE`/`password`/`<script>` blocklist, which false-positived on exactly the DB/security READMEs this app targets while protecting nothing 1–3 don't already cover.
- **Consequences:** a quiz *about* SQL injection may legitimately contain `DROP TABLE` in an answer — harmless, because it is plain-text rendered and grounded in the source. Vitest covers: bidi/zero-width stripped, `<script>` event handler stripped, `javascript:` URI stripped, ungrounded question rejected, secret-shaped token triggers retry.
- **Why we don't strip HTML comments / link titles / alt text:** they are **legitimate quiz material** (author notes, TODOs, architecture rationale, link descriptions, image descriptions). Stripping them loses quiz-quality information for zero security benefit — these are not execution vectors and don't reach the browser (the LLM is not a browser).

#### FR-16: Bounded critical path (single LLM call) + doc-size guard
[User] reaches a playable quiz in a single LLM call, regardless of document size, **with no map-reduce subagent orchestration**.
- **Supersedes** spec archive §7.1 step 2 (the >12k-token map-reduce is **removed** entirely — see rationale below).
- **Sync (critical path to `ready`):** `fetch → neutralize → chunk → select chunk budget → 1 structured LLM call (questions + categories together) → persist → return`. Chunking stays sync — it is a **prerequisite** for generation and costs milliseconds. The single LLM call generates BOTH the selected categories AND the questions tagged against them (one structured-output call, not two).
- **Doc-size guard (tiered):**
  1. **HTTP body cap: 10 MB** — defensive; prevents zip-bomb OOM during streaming decode.
  2. **Decoded markdown text cap: 2 MB** — covers essentially all real-world documents (kubernetes README ~50 KB; large tutorial ~500 KB; entire docs page 1–2 MB). Hard reject with `400 DOC_TOO_LARGE` before the LLM call.
  3. **Token-estimated cap: ~500 KB of text ≈ 125k tokens** — well below all current model context windows (M3: 1M, Sonnet 5: 1M, GPT-5.x: 200k+, gpt-oss-20b: 131k). Acts as a UX shortcut to reject clearly-too-large docs before burning an LLM call.
   4. **Per-model context window check** — if the doc exceeds the chosen model's context window, return `400 DOC_TOO_LARGE` with `{"hint":"switch provider/model — e.g. MiniMax-M3 supports 1M tokens"}`. The user picks a larger-context model. No silent fallback, no map-reduce.
   5. **Content-density check (doc too short)** — if the document's estimated content is too small to generate the requested `questionCount` (heuristic: `doc_tokens / questionCount < ~500` tokens/question), return `400 DOC_TOO_SHORT` with `{"hint":"reduce questionCount — this document has ~Xk tokens of quiz-able content"}`. Rejects with a clear message rather than padding with filler questions.
- **Why no map-reduce:** modern models (MiniMax-M3: 1M, Anthropic Sonnet 5: 1M, OpenAI gpt-5.x: 200k+, Groq gpt-oss-120b: 131k) handle the vast majority of real READMEs in one shot. Map-reduce adds: subagent orchestration, async coordination, merge/dedupe, race conditions, failure modes — complexity tax for a problem that doesn't exist on the supported model set.
- **Consequences:** `status='pending'` stays in the schema as the **reserved escape hatch** for 202+poll if sync latency ever exceeds browser timeout (~30s). **v1 does NOT use it** — every endpoint is sync HTTP. If we ever flip to async polling, the frontend would poll `GET /api/sessions/:id` every 2–5s until `status='ready'`. Vitest covers: doc under 500 KB → proceeds; doc 500 KB–2 MB → 400 with hint; doc > 2 MB → 400 hard reject; doc with low content density → 400 `DOC_TOO_SHORT` with reduced-questionCount hint; chunk selection deterministic for retries.

#### FR-4: Provider-agnostic LLM adapter
[User] can select any configured (provider, model) per session and the system routes accordingly.
- Spec archive governs: §4.1, §6 (POST validation), §8.3 (capability map), §10 (env vars).
- **Consequences:** Provider SDKs are dynamic-imported on first use. **Default is `minimax/MiniMax-M3`** (user-specified; flagship model; 1M context). MiniMax supported via OpenAI-compat (`api.minimaxi.com/v1`) and Anthropic-compat (`api.minimaxi.com/anthropic`). **OpenRouter free models** are also available (filtered to `pricing.prompt = "0"`); see §10.7.

### 4.2 Quiz Taking + Submission

**Description:** User takes the quiz in the web UI, one question at a time, submits all answers, receives a final score + category breakdown.

**Functional Requirements:**

#### FR-5: Quiz UI (one question at a time)
[User] can answer a quiz question and advance to the next; the UI tracks position, supports prev/next, and submits at the end.
- Spec archive: §12.1, §16.4 (`landing.spec.ts`, `full-quiz.spec.ts`).
- **Every question must be answered** — next/submit are gated on ≥1 selected option. See FR-17 for the authoritative server-side rule.

#### FR-6: Geometric-weighted scoring
[System] can score a submission as `Σ(rawScoreᵢ × weightᵢ) / Σ(wᵢ)` with weights `1.0 × 1.1^(i-1)`.
- Spec archive: §18 (8-question weight sum = 11.4358881). **§9 multi-answer formula is SUPERSEDED** — binding rule below.
- **Multi-answer formula (binding, post-audit 2026-07-16):**
  ```
  hits   = |correct ∩ selected|
  misses = |selected \ correct|
  score  = clamp(round(4 × (hits − misses) / |correct|, 2), 0, 4)
  ```
  The archived `4 × hits / |correct|` **ignored wrong selections**, so selecting all 4 options scored full marks on *every* `multiple` question — a scoring-integrity defect, not an accepted trade-off. Wrong picks now cancel right ones.
- **Invariants:** fully-correct → 4. Empty selection → 0. Select-all → 0. Hit+miss → 0. `single` unchanged: 4 iff sets equal, else 0.
- **Consequences:** Vitest unit tests cover n=0/1/8, all-correct, all-wrong, **select-all scores 0 on every `multiple` shape (2, 3, and 4 correct)**, hit+miss cancellation, negative-before-clamp, empty selection, NaN guard, rounding boundary precision.

#### FR-17: Complete submissions only
[User] must answer every question; partial submissions are rejected.
- **Resolves** the archive's undefined behavior for skipped questions, which made `weightedFinalScore` throw on non-contiguous positions.
- **Server is authoritative** (UI gating in FR-5 is convenience, not enforcement): `POST /submit` must carry exactly one response per session question, with the question-ID set matching the session's set exactly — else **400**.
- **Consequences:** positions are contiguous **by construction**, so the `weightedFinalScore` position invariant holds and can never throw. `scoreQuestion` keeps its empty-selection → 0 branch for API robustness even though the UI cannot produce it.

#### FR-7: Idempotent submission + inline results + insights
[User / network] can safely retry `POST /submit` without double-scoring, and a successful submit returns **one response containing both the scored results and the gap analysis (insights)** — no separate API call.
- Spec archive governs: §11.6 (state transition guard `UPDATE .. WHERE status='ready' RETURNING`).
- **Single response shape** (no separate `/insight` endpoint):
  ```ts
  type SubmitResponse = {
    sessionId: uuid;
    finalScore: number;            // 0..4, per FR-6
    breakdown: QuestionResult[];   // per-question: questionId, position, rawScore, weight, weightedScore, correctAnswers
    categoryBreakdown: CategoryPerformanceDto[];  // per FR-16 aggregator
    insights: {                    // populated only when status='submitted'
      topicsToStudy: { topic: string; reason: string; docSnippets: string[] }[];
      weakCategories: string[];
      strengthByCategory: 'strong' | 'mixed' | 'weak';   // per-category
    };
  };
  ```
- **Insights are computed at submit time** (synchronously, by `CategoryAggregatorService` + `rankWeakCategories` per FR-16) and returned inline in the same response. The chat LLM context includes the same `insights` object so it can answer gap-analysis questions conversationally without a separate fetch.
- **Idempotency:** `UNIQUE(session_id, question_id)` on `user_responses`. Concurrent submits return the cached result.
- **Consequences:** No `POST /api/sessions/:id/insight` endpoint. The Result UI renders the entire response inline (no separate "Analyze gaps" trigger). The chat's `topicsToStudy` and `weakCategories` are loaded into the LLM context as `system` content at session start.

### 4.3 Per-endpoint Ownership

**Description:** Every `/sessions/:id/*` route enforces that the calling user owns the session, via the `@OwnsSession()` interceptor + app-layer filtering, returning 404 (not 403) for both not-found and not-owned.

**Functional Requirements:**

#### FR-8: Per-endpoint ownership enforcement
[Server] refuses any cross-user access to session-scoped resources.
- Spec archive: §11.2.1 — expanded to the **four-layer model** below (decision 2026-07-19; RLS reinstated as a v1 default after the 2026-07-16 removal — see rationale).
- **Binding rule (four-layer — see §10.1 for the full pattern + migration):**
  1. `@OwnsSession()` interceptor validates `X-User-Id` is UUID v4 (format check, no DB query).
  2. Every use-case calls `sessionRepo.findByIdAndUserId(sessionId, userId)` → **404** for both not-found and not-owned (existence-leak prevention).
  3. All session-scoped queries filter by `session_id` (child tables have no `user_id` column — they join through `quiz_sessions`).
  4. **Postgres RLS as the database-layer half** — function-based policies (`EXISTS`-join to `quiz_sessions.user_id` via `current_session_user_id()`) + `FORCE ROW LEVEL SECURITY` on every owned table.
- **Why RLS came back (supersedes the 2026-07-16 "RLS is dropped" note):** the original objections were *implementation* objections, not *feasibility* ones. The "no `user_id` column" problem is solved by **function-based `EXISTS`-join policies** (join through `quiz_sessions`, don't filter a non-existent column); the "table-owner bypass" problem is solved by **`FORCE ROW LEVEL SECURITY`**. The interceptor sets `app.user_id` via `SET LOCAL`, propagated through **AsyncLocalStorage** so the use-case's Drizzle queries share the same transaction. With both fixes, RLS is genuine defense-in-depth, not the illusory control the earlier note described.
- **Companion dev-time enforcement:** CI lint rule `@ai-quiz/no-unscoped-session-query` catches an unscoped `WHERE session_id = ?` at dev time; RLS catches it at runtime if lint was bypassed. Both required.
- **Consequences:** the security test asserts *ownership isolation* (user A cannot read user B's sessions, chats, or insights) at both the app layer (404) and, where testable, the DB layer (RLS returns 0 rows when `app.user_id` is unset).

### 4.4 Chat (with pre-submit guard)

**Description:** Persistent per-session chat thread on the Result page. While session.status='ready', the LLM context excludes question text + correct answers. After submit, full context.

**Functional Requirements:**

#### FR-9: Chat-before-submit guard
[User] cannot exfiltrate correct answers via chat before submission.
- Spec archive governs: §11.2.2 (status check + redacted QuestionDto).
- **Consequences:** Unit test asserts that when status='ready', the LLM context DTO omits `is_correct` and question text.

#### FR-10: Chat persistence (free text, decoupled from questions; context-aware)
[User] can revisit a session from history and see the same chat thread; chat is **free text** and **decoupled from questions** — but messages may optionally carry a `questionId` anchor for focused context.
- Spec archive governs: §5 (chat_messages table), §7.3.
- **Chat LLM context includes both results and insights** at session start (computed at submit time per FR-7): the system prompt contains the session's `finalScore`, `breakdown` (per-question), `categoryBreakdown`, and `insights.topicsToStudy` / `weakCategories`. The chat agent can answer gap-analysis questions like "What should I study next?" without a separate fetch. This is why no `POST /insight` endpoint exists.
- **No pagination:** chat loads latest N=50 messages on render; older messages are archived client-side (not paginated). Keeps the data model simple — no cursor logic, no offset management, no `LIMIT/OFFSET` in queries. If a session has 50+ messages, the UI shows "view older" (loads the older batch on demand) but the hot path is unpaginated.
- **`questionId` anchor is optional.** When the user clicks "Explain Q3" on the result page, the chat input pre-fills with template `Explain question {questionId} — I answered {correctly|incorrectly}: {user_selection}` (auto-populated from the user's stored response). The user can edit before sending. This is a UX convenience, not a coupling — chat messages are still independent units in the DB.

#### FR-11: Tavily tool-calling (grounded answers)
[User] can ask questions that the chat agent answers using web search, summarized before being added to context.
- Spec archive governs: §7.3 (max 2 tool iterations), §11.3 Layer 4 (dual-LLM summarization).

### 4.5 Chat-driven gap analysis (no separate endpoint)

**Description:** Post-submit, the user can analyze gaps **via the chat thread** (FR-10). There is **no separate `POST /api/sessions/:id/insight` endpoint** — the chat LLM has access to all the same context (session, responses, category aggregates, computed `topicsToStudy`) and surfaces gap analysis on demand in chat.

**Why no separate endpoint:**
- Chat LLM has access to session context including category aggregates computed at submit time and persisted in `insights.topicsToStudy` (jsonb).
- A separate endpoint would duplicate state and add a round-trip for what's already available.
- Chat is conversational — gap analysis can follow up ("explain that topic", "what should I re-read?") without a separate artifact.
- Keeping chat as the single user-facing surface for post-submit engagement simplifies the architecture (one conversation stream, not artifact + chat).

**Functional Requirements:**

#### FR-12: REMOVED in 2026-07-19 (chat absorbs it)
Per-user gap analysis is delivered through the chat thread (FR-10). The chat LLM prompt includes the session's `topicsToStudy` array and category aggregates as context. Typing "What should I study next?" or "Where am I weakest?" produces a chat-formatted gap analysis. No separate API endpoint.

**Consequences:** No `POST /api/sessions/:id/insight` endpoint. No `insights` table (or it's used only as a persistence target for the precomputed gap data — never surfaced via API). Vitest asserts the chat LLM context includes `topicsToStudy` for `status='submitted'` sessions.

### 4.6 Provider Config UI

**Description:** The web app fetches a list of configured providers + models and renders a dropdown. User can swap per session.

**Functional Requirements:**

#### FR-14: Provider list endpoint
[Web] can fetch `GET /api/config/providers` and render the dropdown.
- Spec archive governs: §6 (endpoint), §10 (env-driven).

---

## 5. Non-Goals (Explicit)

- **Real auth / user accounts** — UUID-based anonymous sessions; no OAuth, no SSO.
- **Mobile-native apps** — mobile IS a first-class surface (responsive web, dual-panel collapses to tabs, chat input is mobile-friendly, history sidebar collapses to slide-out). Mobile is NOT gated to desktop. A standalone native app is out of scope.
- **Streaming chat responses** — sync HTTP, even though it means 5–30s waits on LLM calls.
- **Non-English documents / i18n** — UI strings + LLM prompts English-only.
- **Production-scale traffic** — free-tier targets (Fly auto-stop + cold starts + provider rate limits) are accepted v1 constraints; horizontal scale is deferred.
- **Multi-tenant admin / dashboard** — no ops UI; ops via Fly + Vercel + Neon dashboards directly.
- **CI/CD pipelines** — manual deploys for v1.
- **Payment / quota** — no Stripe, no per-user cost limits beyond coarse rate limits.

---

## 6. MVP Scope

### 6.1 In Scope

The **15 active FRs** above (FR-15 – FR-17 added by the 2026-07-16 audit; FR-12 and FR-13 removed 2026-07-19). Must run end-to-end on **≥ 2 different README.md** URLs (e.g. pipecat, langchain). Must include:

- Web UI (landing → quiz → dual-panel result)
- REST API (sessions, submit, chat, history)
- Postgres persistence (Drizzle)
- Provider-agnostic LLM via Mastra
- Security: SSRF defense, per-endpoint ownership (4-layer incl. RLS), chat exfil guard, ingest neutralization + output grounding, helmet/CORS/throttler
- Observability: Langfuse + pino redaction
- Tests: Vitest unit + security; Playwright E2E with Page Object Model
- Deploy: Vercel (web) + Fly.io (API) + Neon (DB), all on free tiers
- README documenting run, env, scoring, security, deploy

### 6.2 Out of Scope for MVP

| Item | Reason |
|---|---|
| Streaming responses | Sync HTTP acceptable for v1; would require SSE plumbing |
| Real auth | UUID identity is sufficient for anonymous demo |
| Delete session / GDPR export | Not in v1 scope; deferred to v2 |
| Multiple topic support | Single source URL per session; topic is a hint |
| Chat file attachments | Text-only per v1 spec |
| Quiz sharing / public link | UUID-only access |

---

## 7. Success Metrics

**Primary**
- **SM-1**: **End-to-end demo runs on ≥ 2 different Markdown documents** without code changes between runs. Validates FR-1, FR-3, FR-4.
- **SM-2**: **All Vitest suites pass** (`shared`, `api` unit + integration + security). Validates FR-1, FR-6, FR-7, FR-8, FR-9.
- **SM-3**: **Playwright happy-path E2E passes** (`landing.spec.ts`, `full-quiz.spec.ts`, `chat.spec.ts`). Validates FR-5, FR-10.

**Secondary**
- **SM-4**: **Deploy succeeds** on Vercel + Fly.io + Neon free tiers; `/healthz` returns 200 within 30s of machine boot. Validates deploy topology.
- **SM-5**: **Langfuse traces** captured for every LLM call within 60s of session completion. Validates observability.

**Counter-metrics (do not optimize)**
- **SM-C1 (REMOVED 2026-07-19):** ~~LLM cost per session must stay below $0.50.~~ The per-session cost cap was a self-imposed complexity (required a per-call cost tracker on every LLM invocation + a budget-enforcement path that competed with rate limits). It is **removed** — no `cost_spent` column, no per-session budget guard. The free-tier providers (MiniMax-M3 at 20 RPM / 1M TPM, OpenRouter free) already cap usage; rate limits (§10.2) are the only cost-control surface.
- **SM-C2**: **First-request latency > 30s** is acceptable for cold-start demo, but **< 5s for warm requests** (Fly machine + Neon wakeup). Counterbalances optimization for cold-start latency at the cost of steady-state performance.

---

## 8. Open Questions

1. **OQ-1:** ~~Do we wire MiniMax as a default or opt-in only?~~ **RESOLVED 2026-07-18:** Default is `minimax/MiniMax-M3` (user-specified). Groq remains opt-in via provider dropdown.
2. **OQ-2:** ~~Should chat be available on mobile, or fully gated to desktop?~~ **RESOLVED 2026-07-19:** Mobile is a first-class surface. Chat works on mobile via the dual-panel → tabs collapse. No "best on desktop" notice.
3. **OQ-3:** What happens if the LLM returns < 5 questions (e.g. doc too short)? *Recommendation: pad with `"general"` template questions only with user opt-in; otherwise return fewer questions with an `actualCount` field surfaced in the UI.*

---

## 9. Assumptions Index

> All `[ASSUMPTION]` tags from this PRD and SPEC implementation choices, surfaced for explicit confirmation:

- **[A-1]** v1 is a demonstration / reference implementation, not a commercial production launch — calibration in §7 reflects this.
- **[A-2]** A developer learning a new technical library is the primary user — JTBDs/UJs in §2 framed around "Sam".
- **[A-3]** Two specific READMEs (pipecat + langchain) are the canonical test corpus for FR-1/FR-3 verification.
- **[A-4]** BMAD Fast path produces this PRD (not Coaching) — chosen by user implicitly via `@skills/bmad-prd` invocation.
- **[A-5]** PRD supersedes original SPEC.md; SPEC archived for reference only.
- **[A-6]** **REVISED 2026-07-18:** Default provider is `minimax/MiniMax-M3` (user-specified; flagship; 1M context; auto caching only). Groq remains opt-in via provider dropdown.
- **[A-7]** **REVISED 2026-07-19:** Mobile is a first-class surface in v1 — responsive web with dual-panel → tab collapse on narrow viewports. Forms, chat input, and history sidebar are all mobile-friendly. Standalone native app is out of scope; mobile is fully supported via the web.
- **[A-8]** **No polling in v1.** All endpoints are sync HTTP; the browser shows a spinner during the LLM call (5–30s typical). `status='pending'` is **reserved schema space** for a future async-polling escape hatch (return `202 Accepted` + `sessionId`, frontend polls `GET /api/sessions/:id` every 2–5s) — only built if sync latency ever exceeds browser timeout (~30s). Streaming responses likewise deferred. The browser calls Fly directly (no Vercel function in the path), so no gateway timeout applies.
- **[A-9]** *(added 2026-07-16)* The audit resolutions in `.memlog.md` (the "Resolved Ambiguities" section, mirrored from this PRD's former decision log) marked `[REVISED]` / `[NEW]` / `[CLARIFIED]` supersede the SPEC archive. The archive is frozen at 2026-07-16 and is **not** maintained — where the two disagree, this PRD wins.

---

## 10. Cross-Cutting NFRs

> System-wide quality attributes that span features. Each NFR binds a release-blocking constraint.

### 10.1 Security (Critical — release-blocking)

- **SSRF defense** (`HttpMarkdownAdapter`): expanded IP blocklist (RFC1918 + CGN `100.64/10` + Oracle IMDS `192.0.0/24` + benchmarking `198.18/15` + multicast + reserved + IPv6 ULA + 6to4 + IPv4-mapped IPv6 normalization + IDN homograph + HTTP/0.9 rejection). DNS-pin-then-validate; bind undici `Agent` to validated IP; disable redirects; **tiered size limits (10 MB HTTP body / 2 MB decoded markdown / ~500 KB token-estimated)**; 10s timeout.
- **Per-endpoint ownership** (FR-8): every `/sessions/:id/*` route uses the `@OwnsSession()` interceptor + app-layer `WHERE user_id = ?`; returns **404** (not 403) for both not-found and not-owned. **RLS is in v1 as the 4th enforcement layer (see below) — not deferred to v2.** The interceptor + use-case + session-scope-query pattern is still the app-layer half; RLS is the database-layer half. Both must work; if either fails, the other catches.
- **Four-layer enforcement model** (the v1 decision — `2026-07-19`, updated `2026-07-19`):
  1. **Interceptor validates** `X-User-Id` is UUID v4 format once per request (cheap format check, no DB query).
  2. **Use-case does ownership check** — every use-case calls `sessionRepo.findByIdAndUserId(sessionId, userId)`; if no row, throw `NotFoundError` → 404 (existence-leak prevention).
  3. **All session-scoped queries filter by `session_id`** — never by user_id directly (tables don't have a user_id column; everything goes through `quiz_sessions`).
  4. **Postgres RLS as the database-layer half** (function-based + `FORCE ROW LEVEL SECURITY`) — sets the per-request `app.user_id` GUC and every session-scoped table joins to `quiz_sessions` via the policy. Defense-in-depth: even if app-layer code is bypassed, DB rejects.
- **Code review / CI lint rule** (companion dev-time enforcement):
  - **Goal:** catch a developer accidentally writing a query that skips the user_id filter.
  - **Rule:** every `findBySessionId*` / `WHERE session_id = ?` query in domain + adapters layers must be inside a method/function whose name starts with `forUser` or `forUserSession` (or be wrapped by an explicit `assertUserOwns(sessionId, userId)` call).
  - **Implementation:** an ESLint custom rule (`@ai-quiz/no-unscoped-session-query`) that fails the build if a `WHERE session_id =` clause appears outside a `forUser*` context. Tests the rule against a fixture of known-bad and known-good queries.
  - **Why not just rely on RLS alone:** the lint rule is at the dev layer; RLS is at the DB layer. Both are required. Lint catches the failure mode at dev time so it never gets to RLS. RLS catches at runtime if lint was bypassed (e.g. raw SQL outside ESLint's reach).
- **Postgres RLS migration** (v1, function-based):
  ```sql
  -- Helper: read per-request user_id set by the interceptor
  CREATE OR REPLACE FUNCTION current_session_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT current_setting('app.user_id', true)::uuid
  $$;

  -- Enable RLS + FORCE on every owned table (FORCE prevents Neon table-owner role from bypassing)
  ALTER TABLE quiz_sessions        ENABLE ROW LEVEL SECURITY;
  ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
  ALTER TABLE questions            ENABLE ROW LEVEL SECURITY;
  ALTER TABLE answers              ENABLE ROW LEVEL SECURITY;
  ALTER TABLE user_responses       ENABLE ROW LEVEL SECURITY;
  ALTER TABLE insights             ENABLE ROW LEVEL SECURITY;
  ALTER TABLE knowledge_categories ENABLE ROW LEVEL SECURITY;
  ALTER TABLE chat_messages        ENABLE ROW LEVEL SECURITY;
  -- And FORCE on each so the table-owner role doesn't bypass
  ALTER TABLE quiz_sessions        FORCE ROW LEVEL SECURITY;
  ALTER TABLE documents            FORCE ROW LEVEL SECURITY;
  -- (etc. for every owned table)

  -- Per-table policies: existence-join through quiz_sessions.user_id
  CREATE POLICY user_owns_session ON quiz_sessions
    USING (user_id = current_session_user_id());

  CREATE POLICY user_documents ON documents
    USING (
      EXISTS (
        SELECT 1 FROM quiz_sessions s
        WHERE s.id = documents.session_id
        AND s.user_id = current_session_user_id()
      )
    );

  -- (similar for questions, answers, user_responses, insights, knowledge_categories, chat_messages)
  ```
  - **Interceptor must `SET LOCAL app.user_id = '<uuid>'`** per request (in the same transaction as the use-case's queries). If the GUC is unset, `current_setting('app.user_id', true)` returns NULL, the policy's `EXISTS` returns false, the query returns zero rows. **404 (not 403)** — same response as not-found (existence-leak prevention).
  - **Why `FORCE ROW LEVEL SECURITY` matters:** without it, the Neon table-owner role bypasses RLS entirely — the policies would be advisory only. The interceptor + the FORCE flag are **both** required; either alone is insufficient.
  - **Cost:** function-based policies add a subquery (`EXISTS (...)`) to every session-scoped read. At v1 scale (single-user, single-session) the cost is negligible (a few µs per query). At higher scale the subquery is covered by the same `idx_quiz_sessions_user_id_created_at` index as the app-layer `WHERE user_id = ?` filter.
- **Chat before submit** strips question text + correct answers from the LLM context (FR-9).
- **Gap analysis via chat (no insight endpoint)**: gap analysis is delivered through the chat thread (FR-10) using the submit-time `topicsToStudy[]` + category aggregates; there is **no `POST /insight` endpoint**. (FR-12 and FR-13 removed 2026-07-19; the former `insight-requires-submit` 409 guard no longer applies — the chat-before-submit guard (FR-9) is the remaining exfil control.)
- **Ingest neutralization + grounding** (FR-15): deterministic scrub at ingest; structured output + plain-text Q/A rendering + grounding check on output. **No keyword blocklist.**
- **Identity**: `X-User-Id` only. **HMAC binding removed** — the browser had to compute it, so `USER_HMAC_SECRET` shipped client-side and any attacker could forge valid HMACs as cheaply as the app; it bought ~zero security while costing quarterly rotation that breaks live clients. Spoofing is answered by per-route **IP-keyed rate limits** (§10.2), which is what actually does the work.
- **Submit idempotency**: `UNIQUE(session_id, question_id)` on `user_responses`; atomic `UPDATE quiz_sessions SET status='submitted' WHERE id=? AND status='ready' RETURNING ..`.
- **pino redaction**: deny-list with allowlist. Always redact `Authorization`, `x-api-key`, `cookie`, `x-user-id`, `req.body.*`, all `*_KEY` env vars.
- **CORS**: exact `WEB_ORIGIN` always. `WEB_ORIGIN_REGEX` applies **only when `NODE_ENV !== 'production'`** — in prod, exact origin only. (The archive's "reject regex matches when `x-vercel-environment: production` is absent" is **removed**: that header exists inside Vercel's runtime and is never present on a cross-origin browser request to Fly, so the check could not work.)

### 10.2 Rate Limiting

Every route is limited **twice — once keyed by `X-User-Id`, once keyed by IP — and the stricter wins.** Same table, both keys:

| Endpoint | Per-user limit | Per-IP limit |
|---|---|---|
| Global | 30/min | 30/min |
| `POST /sessions` | 5/min (LLM call) | 5/min |
| `POST /chat` | 20/min | 20/min |

429 with `Retry-After`.

- **The IP key is the real control**, since `X-User-Id` is forgeable and HMAC binding was removed (§10.1). The archive's "5 req/**sec**/IP" fallback was **looser than the per-user limit it backed** — 300/min from one IP vs 30/min per user — so a UUID-rotating attacker got a **10× budget increase** by rotating. Mirroring the per-route table onto the IP key closes that hole.
- **In-memory store — accepted** (decision 2026-07-16). Valid **only** while the API runs on exactly **one** machine. Fly auto-stop wiping counters on idle is fine (an idle machine is not under attack). **`max_machines_running` must be pinned to 1** — with N machines, per-machine counters silently multiply every limit by N.
- Switch to a Redis store (Upstash free) **if and only if** the deploy ever scales out.

### 10.3 Observability

- **Langfuse** traces every LLM call: prompt, completion, latency, tokens, model, provider, cache hit/miss, sessionId, userId. Content scrubbing on chat after 7 days.
- **pino** structured logs with redaction of API keys, cookies, auth headers.
- **`/api/health`** checks DB + provider reachability.
- Per-session LLM cost budget: **REMOVED 2026-07-19** — no `cost_spent` column, no per-session guard. Cost control is via free-tier provider caps + rate limits (§10.2) only.

### 10.4 Testing Discipline

- Pure scoring/aggregation → Vitest unit tests in `packages/shared/test/`.
- API integration + security → Vitest in `apps/api/test/`.
- E2E → Playwright + Page Object Model. `data-testid` on every interactive element. Tests use `getByTestId(..)` only.
- Every BMAD story must update or add tests for changed behavior.
- **Test results include gap analysis + insights** — Vitest and Playwright suites output not just pass/fail but also the category gap analysis and any captured insights as part of the report. There is **no separate test run** for these; they're produced as a side-effect of the standard test pass. Implementation: a Vitest reporter hook + a Playwright `testInfo` annotation that pull gap data from `quiz_sessions` (post-submit fixtures).

### 10.5 Frontend State

- **Server state**: TanStack Query v5. Query-keys factory in `apps/web/lib/queries.ts`.
- **Client state**: React Context (UUID, theme) + `useState` per-component + custom `useLocalStorage` hook.
- **No Zustand, no Redux** — overkill for this scope.
- UUID generated in `<head>` inline script **before** React hydrates (avoids first-request race).

### 10.6 Deployment Topology

- Vercel (web) + Fly.io (API) + Neon (DB). Migrations run as `fly.toml release_command` (`node dist/main.js migrate`).
- **Base image `node:22-slim`** (not alpine — avoids native-build headaches). **The archive's `node:20-slim` is WRONG and must not be copied**: Mastra requires Node `>= 22.13.0` (§A.2), so a Node 20 image fails the `engines` check and breaks the API in the one environment that matters.
- **`max_machines_running = 1` — required, not incidental.** The in-memory rate limiter (§10.2) is only correct on a single machine.
- Fly free-tier caveat: `min_machines_running=1` is not available — use external cron pinging `/healthz` every 4 min to keep warm.
- **Reaffirmed 2026-07-16:** Mastra requires Node `>= 22.13.0` (architecture-spec.md §A.2), so a Node 20 base image fails `engines` and breaks the API in the one environment that matters. Use `node:22-slim`.
- Fly free-tier caveat: `min_machines_running=1` is not available — use external cron pinging `/healthz` every 4 min to keep warm.
- Two health endpoints: `/healthz` (Fly, ~1 ms, process-alive only) vs `/api/health` (monitoring, deep-checks DB + providers).
- Provider SDKs dynamic-imported in `LlmAdapter` on first use — avoids 256 MB OOM on Fly free tier.
- Async enrichment (FR-16) runs in-process. Fly auto-stop may kill it mid-flight; that is safe **by design** — enrichment is never a correctness dependency.

### 10.7 Provider Rules (v1 scope — MiniMax + OpenRouter free)

**v1 supports two provider tiers: MiniMax (paid but cheap) and OpenRouter free models.** No other pay-as-you-go providers in scope. Adding another provider is a PRD change (out of v1 scope).

- **Default:** `minimax/MiniMax-M3` (user-specified; flagship; 1M context; auto caching only).
- **MiniMax specifics:**
  - Model ID `MiniMax-M3` (hyphen, not space). M3 supports **auto caching only** (no explicit `cache_control`). M2.x supports explicit.
  - Round-trip `reasoning_details` (OpenAI-compat via `extra_body={"reasoning_split": true}`; Anthropic-compat via full `content[]` array including `thinking` + `signature` blocks).
  - **Regional:** `MINIMAX_REGION=intl` switches to `api.minimax.io`; mainland China is default (`api.minimaxi.com`).
  - **Free tier:** 20 RPM / 1M TPM. Sufficient for v1 demo use.
- **OpenRouter free models** (opt-in via FE dropdown; default falls back to MiniMax if `OPENROUTER_API_KEY` is unset):
  - `meta-llama/llama-3.3-70b-instruct:free`
  - `google/gemini-2.0-flash-exp:free`
  - `qwen/qwen-2.5-72b-instruct:free`
  - `mistralai/mistral-small-3.1-24b-instruct:free`
  - *(catalog may rotate; see OpenRouter `/models?free=true` for the live list — capability matrix filters on `pricing.prompt = "0"`)*
  - **Free-tier caveat:** OpenRouter free models have rate-limit and SLA differences; if a free-tier call fails, fall back to MiniMax-M3 transparently (single retry).
- **Out of v1 scope:** Anthropic / OpenAI / Groq / Ollama (each requires its own API key + pay-as-you-go budget — defer to v2). The FE provider dropdown shows MiniMax-M3 as default + OpenRouter free models as opt-in.

### 10.8 Scoring (math has subtle invariants)

- Multi-answer score = `clamp(round(4 × (hits − misses) / |correct|, 2), 0, 4)` where `hits = |correct ∩ selected|`, `misses = |selected \ correct|`. Full-correct → 4. Empty → 0. **Select-all → 0.** Throws on `n<=0`. (Post-audit 2026-07-16 — supersedes `4 × hits / |correct|`, which scored select-all as full marks.)
- Single: `type='single'` requires exactly 1 correct; multi requires 2..4 correct. Validated at LLM-output boundary.
- Submissions must be complete — one response per question (FR-17) — so positions are contiguous by construction.
- 8-question geometric weights sum to **11.4358881**, not 12.
- Categories use `avgRawScore` for comparison (not `weightedScore` — position-biased, not comparable across categories).
- Strength thresholds: `>=3.0` strong, `>=1.6 AND <3.0` mixed, `<1.6` weak. Boundaries are exclusive of overlap.

---

## Addendum A: Implementation Reference

> The complete implementation reference (data model columns, REST API shapes, agent flows, env vars, scoring module signatures, build order, etc.) lives in `_bmad-output/planning-artifacts/specs/architecture-spec.md`.
>
> That file is a **temporary pre-implementation reference**: its content migrates into actual code artifacts (Drizzle migrations, Zod schemas, `.env.example`, NestJS controllers) when implementation begins. After migration, this reference can be deprecated.
>
> The Architecture Spine (`_bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md`) is the **authoritative architecture doc** — invariant-only ADs distilled from the PRD + this reference + `project-context.md`.

---

## Document Status

- **PRD** is `draft` and ready for review.
- **Audit pass applied 2026-07-16** — adversarial review of the SPEC archive; 10 resolutions written in. Changed rules are marked `[REVISED]` / `[NEW]` / `[CLARIFIED]` in `.memlog.md` (Resolved Ambiguities section) and stated inline in their FRs. Headline changes: multi-answer scoring now penalizes wrong picks (select-all no longer scores 4); RLS + HMAC binding removed as non-functional; map-reduce removed entirely (single LLM call on a chunked budget; doc-size guard rejects oversized docs with model-switch hint); insight is whole-quiz only (no per-question endpoint); strategy required from user; categories randomly selected from LLM-derived pool; keyword blocklist replaced by grounding + plain-text rendering.
- **Next BMAD workflows** (in fresh chat each):
  1. `/bmad-architecture` — **REGENERATE** the architecture spine from this corrected PRD. ⚠️ The existing `ARCHITECTURE-SPINE.md` is **pre-audit and stale** (AD-9 RLS, AD-11 HMAC, AD-19 `node:20`, old scoring formula) and must be replaced, not extended. (`/bmad-create-architecture` is deprecated — use `/bmad-architecture`.)
  2. `/bmad-create-epics-and-stories` — breaks 17 FRs into implementable stories. **Do not run before step 1** — story generation reads the spine, so it would inherit the stale decisions.
  3. `/bmad-check-implementation-readiness` — resolves any PRD/architecture/story conflicts.
  4. `/bmad-sprint-planning` — then sprint loop.


### 10.9 Canonical adapter pattern (DTOs at boundaries)

> Cross-reference: spine AD-3, architecture-spec §A.3, project-context §Architecture Rules. This section captures the v1 binding.

- **Rule:** Every adapter wraps raw I/O results in `Object.freeze(Schema.parse(raw))` before returning. Domain code never sees `unknown`, raw drizzle types, or unvalidated shapes. The schema used is the Zod schema for that entity from `packages/shared/src/schemas.ts`.
- **Direction:** raw I/O (drizzle rows, HTTP request bodies, LLM JSON responses) crosses the boundary one way only — inbound → parsed → frozen → domain. Domain operates on parsed, frozen DTOs.
- **One schema per boundary:** the Zod schema in `packages/shared/src/schemas.ts` is the single source of truth for the entity's shape. It validates (a) DB rows on read, (b) HTTP bodies on write (via `ZodValidationPipe` in the driving layer), (c) LLM JSON outputs on the LLM adapter side.
- **Frozen DTOs:** `Object.freeze(...)` is mandatory. Use cases receive `Readonly<DTO>`-equivalent values; mutation throws in strict mode. Prevents accidental shared-state bugs.
- **No mapping layer:** DTOs are the universal currency. There is no separate `entities/` layer; we don't map entity ↔ DTO between adapter and domain. (See spine AD-3 + architecture-spec §A.3 for the canonical code pattern.)