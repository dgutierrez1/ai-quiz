# Story 3.3: Quiz-taking UI (one question at a time)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to answer questions one at a time and submit a complete set,
so that I can take the quiz and get graded.

## Acceptance Criteria

_(FR-5, FR-17 client gate, AD-17; UX: DESIGN.md, EXPERIENCE.md)_

1. **Ready session renders one question at a time.** Given `/quiz/[id]` for a session with `status='ready'`, then it fetches the session via `GET /api/sessions/:id` (no `is_correct` in the payload — server-enforced, AD-12/AD-3), renders exactly one question at a time with its 4 answer options **in server order, positions 0–3, never shuffled client-side** (shuffling breaks the per-question breakdown position mapping on the result page), and shows a position tracker ("`{n}` of `{total}`" per EXPERIENCE.md). `category` is never rendered on this page even if present on the wire — it is revealed only at `/result/[id]` (EXPERIENCE.md: "Categories are hidden here and revealed only at results").
2. **Non-`ready` statuses never render a broken or empty quiz.** Given `/quiz/[id]` for a session whose `status` is not `ready`:
   - `submitted` → redirect (`router.replace`) to `/result/[id]` without rendering any quiz content, and without re-submitting on back-navigation.
   - `failed` → render `ErrorState` (reused from `apps/web/components/states/`) with `error_message`-derived copy and a retry affordance. Retrying a failed generation is **not** "resume this session" (there is no partial-regeneration endpoint) — it routes to `/` so the user restarts via `POST /api/sessions` (owned by Epic 2). See Dev Notes for the exact behavior.
   - `pending` → render a generation-in-progress state (**Story 5.1 routes `pending` sessions here on resume**, so this is reachable even though normal `POST /api/sessions` is synchronous and never returns while `pending`). No polling (client-side or server-side) — v1's `[A-8]` decision is sync-only; see Dev Notes for the exact copy/behavior, flagged as an `[ASSUMPTION]` gap in the UX spec.
   - Not-found / not-owned (**404** from the API) → "This session isn't available." — cross-user and nonexistent are **indistinguishable by design** (EXPERIENCE.md); the copy must not hint that the session exists.
3. **Answer option renders and behaves per `DESIGN.md`'s `{components.answer-option}` spec.** `single` → radio semantics, exactly one selection, picking another replaces it. `multiple` → checkbox semantics, the user may select any number — **the UI never hints how many of the 4 are correct**. Unselected: `{colors.surface-raised}` fill, 1px `{colors.surface-sunken}` border, `{rounded.md}`, 16px padding, **48px minimum height**. Selected: fill swaps to `{colors.surface-sunken}` **and** the border **thickens to 2px `{colors.primary}`** — selection is conveyed by border weight _and_ color, **never by color alone** (this is the accessibility requirement, not a style choice — DESIGN.md is explicit that this pairing is deliberate). Entire option row (including the label) is the hit target.
4. **Next/Submit gating is a client convenience; the server remains authoritative.** Given a question, then Next (or Submit, on the last question) is disabled until **≥1** option is selected on the current question (FR-5); this is UI convenience only — `POST /submit` independently rejects an empty `selected: []` with 400 (FR-17, AD-N5), and this story must never assume the client gate is sufficient on its own.
5. **Answers persist across Previous/Next within the session.** Given the user has answered question _k_ and navigates away and back via Previous/Next, then the previously selected option(s) are still shown selected — answer state lives in component state for the duration of the visit (no server round-trip on navigation, no polling). Previous is enabled from question 2 onward; Next becomes **Submit** on the last question.
6. **Submit posts the complete response set and navigates on success.** Given the last question is answered and Submit is clicked, then it `POST`s `/api/sessions/:id/submit` with **exactly one response per session question**, the question-ID set matching the session's set exactly (AD-N5) — by construction, since gating (AC #4) already forced every question to have ≥1 selected option before Submit is reachable. Submit and all navigation controls are disabled for the duration, with a non-blocking narrated wait (reuse `NarratedWait` from Story 2.7 with the submission-specific stage copy — see Dev Notes). On a `200` response, it navigates to `/result/[id]`. On failure, render mapped error copy with retry (form/answer state preserved) — including the `409` case (session was not `ready` — surface the returned status and route back per EXPERIENCE.md) and the `429` case (`POST /submit` is not separately rate-limited beyond the Global 30/min tier — NFR-2 — but the UI must still handle a 429 the same way Story 2.7 does for `/sessions`).
7. **Question shortfall is disclosed, not hidden.** Given the session's response carries `actualCount` (generator produced fewer than the requested `questionCount` — AD-N4's shortfall ladder, owned by Stories 2.4–2.6), then a single, quiet inline note appears once at the top of the first question: _"This document supported **`{actualCount}`** questions rather than `{questionCount}` — try a longer document if you'd like the full set."_ Framed as a document property, never blame (EXPERIENCE.md Trust & Disclosure). Position tracking and gating use `actualCount`, not the originally requested count.
8. **`data-testid` on every interactive element.** Question card, each answer option, Previous button, Next/Submit button, position indicator, shortfall note, error/retry/empty-state controls, generation-in-progress state container — all carry `data-testid`. The **enforcing** ESLint rule `@ai-quiz/require-data-testid` is **not** built in this story (Story 5.2), per the same resolution Story 2.7 already established.
9. **No structural breakpoint on this route.** Given any viewport width, then `/quiz/[id]` renders **single-column at every width** — one question card capped at a comfortable reading measure, centered. Per `DESIGN.md`/`EXPERIENCE.md` (both `status: final`): _"`/quiz/[id]` is single-column at every width and has no structural breakpoint at all — one question card in a reading measure. Story 3.3 must not introduce one."_ This satisfies epics.md's literal AC text ("reflows to single-column below `md`") trivially, because there is no wider-than-single-column state to reflow _from_ — do not add `md:`-gated layout branching where none is needed (see Dev Notes for the resolved epics.md-vs-UX-artifact wording).
10. **Voice, tone, and accessibility floor.** All copy (shortfall note, errors, generation-in-progress, empty states) follows `EXPERIENCE.md`'s Voice and Tone rules (second person, present tense, no exclamation marks, no emoji, no gamification, name the remedy not the blame). One `<h1>` per surface (or the question text carries the primary heading role — see Dev Notes), `<fieldset>`/`<legend>` for each question's option group, a visible 2px `{colors.accent}` focus ring (2px offset) on every interactive element, `aria-live="polite"` announcing question-advance and errors (one announcement per change), focus moves to the question text on advance (EXPERIENCE.md Interaction Primitives), usable at 200% zoom with no horizontal scroll, 44px+ touch targets (answer options are 48px per DESIGN.md).
11. **Tests.** Vitest component tests cover: status branching (ready/submitted/failed/pending/not-found), gating (Next/Submit disabled until ≥1 selection, single vs multiple semantics), answer persistence across Previous/Next, shortfall note rendering when `actualCount` is present, submit success → navigation, submit error/409/429 handling. Full Playwright E2E (`full-quiz.spec.ts`) is **not** built in this story — see Scope Boundary.

## Tasks / Subtasks

- [ ] **Task 1 — Dynamic route shell** (AC: #1, #2)
  - [ ] Create `apps/web/app/quiz/[id]/page.tsx`. **Next.js 15 App Router note (first dynamic segment in this repo):** `params` is a `Promise<{ id: string }>` in Next 15 Server Components, not a plain object as in Next 14 — `await params` (or thread it through `React.use()` if the page itself must be a Client Component). Keep `page.tsx` a thin async Server Component that awaits `params` and renders a Client Component (`components/quiz/quiz-runner.tsx`) with `sessionId` as a plain string prop — the actual data fetch needs the UUID from `UserProvider` (client-only Context, Story 2.7), so it cannot happen in the server component.
  - [ ] `quiz-runner.tsx` (`'use client'`) owns: the `GET /api/sessions/:id` query, status branching (AC #2), and rendering the question-taking UI when `status === 'ready'`.
- [ ] **Task 2 — Extend the query-keys factory** (AC: #1, #6)
  - [ ] `apps/web/lib/queries.ts` (Story 2.7's factory — **extend, do not fork**): add `queryKeys.sessions.detail(id)` + `useSessionQuery(id)` (`GET /api/sessions/:id`) and `useSubmitAnswersMutation(id)` (`POST /api/sessions/:id/submit`). Both go through `apps/web/lib/api.ts` (Story 2.7's single fetch surface) — no ad hoc `fetch()` calls.
  - [ ] Coordinate the exact response/request shapes with Story 3.1 (concurrent authorship) — see Dev Notes → API contract.
- [ ] **Task 3 — Status-branch rendering** (AC: #2)
  - [ ] `submitted` → `router.replace('/result/' + id)` inside an effect (not during render); no quiz content flashes first.
  - [ ] `failed` → reuse `ErrorState` (Story 2.7) with `error_message`-derived copy; retry button routes to `/` (do not attempt to invent a "resume generation" flow — no such endpoint exists).
  - [ ] `pending` → new lightweight state (this component only; not a generic addition to `components/states/` unless a second consumer emerges) — see Dev Notes for exact copy/behavior since the UX spec doesn't fully define this state.
  - [ ] 404 (`GET /api/sessions/:id` not-found/not-owned) → "This session isn't available." — no hint of existence either way.
- [ ] **Task 4 — Question card + answer options** (AC: #1, #3, #9, #10)
  - [ ] `apps/web/components/quiz/question-card.tsx` — renders question text (`{typography.question}` 20px/500/1.5), the position tracker, and the answer-option list. Plain-text rendering only — `{text}` auto-escaping, never markdown/HTML (AD-N1; this page renders neither explanations nor chat, so `lib/sanitize.ts` is out of scope here — Story 4.3 builds it).
  - [ ] `apps/web/components/quiz/answer-option.tsx` — implements `{components.answer-option}` / `{components.answer-option-selected}` exactly (AC #3): radio group (`single`) via `RadioGroup` (shadcn/Radix), checkbox group (`multiple`) via individually tabbable `Checkbox`es — Radix supplies correct roles/keyboard handling out of the box (EXPERIENCE.md: "already supply correct roles, focus management, and keyboard handling").
  - [ ] Single column, capped at a comfortable reading measure, centered — no `md:`/`lg:` breakpoint classes on the outer layout (AC #9).
- [ ] **Task 5 — Navigation + answer-state** (AC: #4, #5)
  - [ ] `useState`/`useReducer` in `quiz-runner.tsx` (or a small custom hook) holding `Record<questionId, selectedPositions[]>` and `currentIndex` — **component-level state, not a new React Context** (AD-17/NFR-5: exactly two Contexts exist — UUID, theme — do not add a third for quiz-answer state).
  - [ ] Previous/Next/Submit buttons; Next disabled until `selected[currentQuestion].length >= 1`; Next becomes Submit on the last question; Previous enabled from question 2.
  - [ ] Focus moves to the question text on advance (`ref` + `.focus()` on a `tabIndex={-1}` heading/paragraph); `aria-live="polite"` region announces the change.
- [ ] **Task 6 — Submit flow** (AC: #6)
  - [ ] `useSubmitAnswersMutation(id)` fires on Submit; disables all controls; mounts `NarratedWait` (Story 2.7's generic component) with the submission stage list: `Scoring your answers…` → ~4s → `Working out where the gaps are…` (EXPERIENCE.md exact copy).
  - [ ] Build the request body from the answer-state map — **exactly one entry per session question**, matching the session's question-ID set exactly (AC #6 / AD-N5). This holds by construction given Task 5's gating, but assert it defensively (e.g. a dev-time invariant check) rather than trusting it silently.
  - [ ] On success (`200`): `router.push('/result/' + id)`. Do **not** build `/result/[id]`'s content — see Scope Boundary.
  - [ ] On `409`: parse the returned status from the body and route accordingly — `submitted` shouldn't occur here (that's the cached-result 200 path per AD-15) but `pending`/`failed` reuse the same branches as Task 3.
  - [ ] On `429`/`5xx`: reuse `RateLimitedState`/`ErrorState` (Story 2.7) with preserved answer state.
- [ ] **Task 7 — Shortfall note** (AC: #7)
  - [ ] Render once, above the first question only, when the session response carries `actualCount`. Use `EXPERIENCE.md`'s exact copy template.
- [ ] **Task 8 — Accessibility + `data-testid` pass** (AC: #8, #10)
  - [ ] `data-testid` on: question card, each answer option (stable per-position id, e.g. `answer-option-{position}`), previous button, next/submit button, position indicator, shortfall note, error/retry controls, generation-in-progress container.
  - [ ] Focus ring token (`{colors.accent}`, 2px, 2px offset) — should already be a global utility from Story 2.7's `@theme` wiring; verify it applies to the Radix-based radio/checkbox items (shadcn primitives sometimes need `focus-visible:` overrides to surface it correctly).
  - [ ] `<fieldset>`/`<legend>` around each question's option group.
  - [ ] Verify 200% zoom, no horizontal scroll.
- [ ] **Task 9 — Tests** (AC: #11)
  - [ ] Extend `apps/web`'s Vitest component-test project (installed by Story 2.7 — do not add a new runner). Cover the scenarios listed in AC #11.
  - [ ] Full Playwright `full-quiz.spec.ts` + `QuizPage` POM class are **out of scope** — Story 5.2 builds them (epics.md Story 5.2 AC explicitly owns `full-quiz.spec.ts`).
  - [ ] Run `pnpm --filter @ai-quiz/web test` before marking done.

## Dev Notes

### 🚨 Scope boundary — read first

Epic 3 is ordered backend → result-page shell → quiz UI specifically so this story can consume, not guess at, its dependencies. Both are correct as of this writing but are being authored **concurrently** with this story — coordinate on exact schema/export names during implementation rather than re-deriving them.

| Belongs to           | NOT this story                                                                                                                                                                                                                                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Story 3.1**        | `POST /api/sessions/:id/submit` implementation, scoring, `categoryBreakdown`, `insights` computation, the `409`/idempotency state-machine logic                                                                                                                                             | This story only **calls** submit and renders its own loading/error states around the call. It does not implement scoring or the insights shape.                                                                                                                                                                                                                                           |
| **Story 3.2**        | `/result/[id]` page, dual-panel shell, results panel, chat slot                                                                                                                                                                                                                             | Not reachable from this story except via the `router.push`/`router.replace` navigations in AC #2 and #6. Do not build any of its content here.                                                                                                                                                                                                                                            |
| **Story 2.7 (done)** | FE substrate: `apps/web/lib/api.ts`, the query-keys factory shape in `apps/web/lib/queries.ts`, `UserProvider`/UUID-before-hydration, `ThemeProvider`, `apps/web/components/states/{narrated-wait,error-state,rate-limited-state,empty-state}.tsx`, `@theme` design tokens in `globals.css` | **Reuse verbatim** — extend the query-keys factory and reuse the shared state components with different props/copy, exactly as `NarratedWait` is designed to be reused (2.7's Dev Notes call this out explicitly: "Story 3.1's submit narration reuses it with different copy/timings" — this story is now that consumer, one epic later than originally anticipated but same component). |
| **Story 2.1–2.6**    | `POST /api/sessions`, question-pool generation, category selection, persistence                                                                                                                                                                                                             | This story never creates or regenerates a session. A `failed` session's retry affordance routes to `/`, it does not re-attempt generation for the same `sessionId`.                                                                                                                                                                                                                       |
| **Story 4.3**        | Chat panel, `apps/web/lib/sanitize.ts` (DOMPurify wrapper), "Explain Qn" control                                                                                                                                                                                                            | `/quiz/[id]` has **no chat surface** at all (EXPERIENCE.md: "Chat exists only on `/result/[id]`" — a deliberate decision, not an oversight; it's also why AD-12's pre-submit chat redaction is unreachable through the UI even though it stays as defense-in-depth server-side).                                                                                                          |
| **Story 5.1**        | History sidebar; the mechanism by which a `pending`/`ready` session's history row navigates here                                                                                                                                                                                            | This story only needs to **handle being landed on** with a `pending` status — it does not build the history list or its row-click routing.                                                                                                                                                                                                                                                |
| **Story 5.2**        | `apps/web/e2e/`, `full-quiz.spec.ts`, `QuizPage` POM class, the enforcing `@ai-quiz/require-data-testid` ESLint rule                                                                                                                                                                        | This story adds Vitest component tests only (Task 9) and hand-applies `data-testid` attributes (AC #8).                                                                                                                                                                                                                                                                                   |
| **Story 1.5 (done)** | The `{error:{code,message,requestId}}` envelope shape, CORS, rate-limit _enforcement_                                                                                                                                                                                                       | This story only **consumes** the envelope via `api.ts`'s existing parsing (built in 2.7) and renders copy for the codes relevant here.                                                                                                                                                                                                                                                    |

### ⚠️ Resolved — epics.md's literal breakpoint AC vs. the UX artifacts

`epics.md`'s Story 3.3 AC text (carried over from before the UX contract landed) says: _"Given a viewport narrower than the shared `md` breakpoint (768 px), Then the quiz UI reflows to single-column with full-width answer targets."_ Read literally as "reflow at `md`," this would imply the quiz UI is **not** single-column above `md` — that is false. `DESIGN.md` and `EXPERIENCE.md` (both `status: final`, and per this file's own binding rule they win on conflict) are explicit and unambiguous: **`/quiz/[id]` is single-column at every width, with no structural breakpoint at all** — "one question card in a reading measure... a question card never needs more than the reading measure, so there is nothing to collapse." `epics.md`'s "Shared UI conventions" section (updated 2026-07-20, after the `lg`-breakpoint correction on the result page/sidebar) states this explicitly too: _"`/quiz/[id]` is single-column at every width and has no structural breakpoint at all... Story 3.3 must not introduce one."_ This story follows that instruction. AC #9 above is satisfied by never adding a wider-than-single-column layout in the first place, not by adding `md:` classes that toggle between two states — there is only ever the one state.

### The `pending` state is a genuine UX-spec gap — flagged, not silently invented

`EXPERIENCE.md`'s per-surface state list for `/quiz/[id]` enumerates _Loading_, _Ready_, _Not found/not owned_, _Fewer questions than requested_, _Already submitted_, _Error_ — but **no `pending` state**, even though `epics.md`'s binding AC for this story explicitly requires one ("Story 5.1 routes `pending` sessions here, so this is reachable"). This is consistent with `[A-8]`'s decision that generation is synchronous and the reserved `status='pending'` + 202 polling escape hatch is "not adopted" for v1 — so in the _overwhelmingly_ common case a user never sees `pending` on this route at all; it is only reachable via a crashed/abandoned generation attempt resumed later from history (UJ-3's edge case, Story 5.1).

Because there is genuinely no live-update mechanism to attach to it (no polling, per the architecture's explicit v1 decision — do not add polling to fill this gap, that would be scope creep against `[A-8]`), build this state as a **static** message consistent with `EXPERIENCE.md`'s Voice and Tone rules — something like _"This quiz is still being generated. Check back in a moment, or start a new one."_ with a manual refresh action (re-run the `GET /sessions/:id` query) and a link to `/`. Do not fabricate a spinner implying imminent completion — there is no server-side signal backing that promise. Flag this resolution in the PR/story review; if a future story (5.1) defines this state differently, reconcile there rather than silently diverging.

### `GET /api/sessions/:id` — consuming a schema still being named (Deferred N6)

The architecture spine records "Wire-projection ownership for `questions`" as an **open** item (Deferred N6): _"no AD names the owner of the outbound `questions` projection, and two projections share the `GET /sessions/:id` boundary (`ready` vs `submitted`)... name the schemas in `packages/shared/src/schemas.ts` during Story 2.4."_ Combined with AD-3's clarification that a `RedactedQuestionSchema` must be a genuine **schema-level projection** (never a runtime `delete is_correct`), this means: whatever exported schema/type Stories 2.4–2.6 land for the `ready`-session question shape is what this story consumes — **do not invent a parallel type**. At minimum expect per question: `id`, `position` (0-based), `text` (≤500 chars), `type` (`'single'|'multiple'`), and 4 `answers[]` each with `id`, `position` (0–3), `text` — and **no** `is_correct`, and this page must not render `category` even if the wire shape happens to include it (defense-in-depth at the UI layer on top of whatever the server redacts). Coordinate the exact export name with whoever lands Stories 2.4/2.6 during implementation, the same way Story 2.7 coordinated `CreateSessionRequestSchema` with Story 2.4.

### `POST /api/sessions/:id/submit` — request/response contract (Story 3.1, concurrent)

No implementation-artifact story file exists yet for 3.1 at the time this story was written (it's being authored in parallel) — the contract below is reconstructed from `epics.md` Story 3.1's ACs + architecture spine AD-15/AD-N5 + the `user_responses` table shape (`question_id`, `selected` jsonb `int[]`). Reuse whatever Zod schema Story 3.1 lands in `packages/shared/src/schemas.ts` — **do not fork a duplicate**; coordinate the exact field/export name during implementation.

Expected shape:

```json
// Request
{
  "responses": [{ "questionId": "uuid", "selected": [0, 2] }]
}
```

- Must carry **exactly one** entry per session question; the question-ID set must match the session's set **exactly** — else `400`.
- Every `selected` array must have **≥1** entry — an empty array is `400`, not scored as 0 (AD-N5, decision 2026-07-19).
- Client-side, this holds by construction (Task 5/6's gating never allows Submit until every question has ≥1 selection) — but the server is the authority, so still handle the `400` path defensively (e.g. if a race condition or a bug in local state ever produces a mismatched set).

```json
// Response (200 — success or idempotent replay)
{
  "sessionId": "uuid",
  "finalScore": 2.8,
  "breakdown": [
    /* per-question: questionId, position, rawScore, weight, weightedScore, correctAnswers */
  ],
  "categoryBreakdown": [/* CategoryPerformanceDto[] */],
  "insights": { "topicsToStudy": [], "weakCategories": [], "strengthByCategory": {} },
  "actualCount": 6 // present only when the generator under-produced
}
```

- This story only needs `sessionId` (to build the `/result/[id]` route) from the response — it does **not** render `finalScore`/`breakdown`/`categoryBreakdown`/`insights` (Story 3.2's job). Don't over-fetch or duplicate rendering logic here; navigate and let `/result/[id]` do its own fetch.
- `409 Conflict` — body carries the current status (`pending` or `failed`); route per Task 6.
- Duplicate/concurrent submit → `200` with the cached result, **never `5xx`** — treat it identically to a fresh success (navigate to `/result/[id]`).

### Design tokens this story uses (`DESIGN.md`) — already wired by Story 2.7, consume don't redeclare

- `{typography.question}` — 20px/500/1.5, Geist Sans — question text, the one thing on screen that matters (per DESIGN.md's framing).
- `{components.answer-option}` / `{components.answer-option-selected}` — see AC #3 for the exact values; this is "the most-touched element in the product" per DESIGN.md, get it byte-exact.
- `{spacing.option-gap}` 12px between answer options.
- `{rounded.md}` 10px for cards/options.
- `{colors.accent}` focus ring, 2px, 2px offset — non-negotiable per-element.
- **Never**: red/`destructive` styling anywhere on this page (a wrong answer is never shown as an error on this route — correctness isn't even revealed here); a determinate progress bar on the submit narration; shuffling answer order; hinting at how many options are correct on a `multiple` question.
- Motion: `motion/react` (not `framer-motion`) `12.42.2` — question-card transition on advance per architecture §A.11/EXPERIENCE.md Interaction Primitives; `prefers-reduced-motion` replaces transitions with instant state changes (EXPERIENCE.md).

### Previous story context

- **Story 2.7** (all Epic 1/2 stories are `ready-for-dev`, no code exists yet in the repo as of this writing) built the entire FE substrate this story depends on: Next.js 15 App Router scaffold, `@theme` tokens, TanStack Query v5 + query-keys factory, `UserProvider`/UUID-before-hydration, `ThemeProvider`, `api.ts`, and the generic `components/states/` set (`NarratedWait`, `ErrorState`, `RateLimitedState`, `EmptyState`). This story is the **first to add a dynamic route** (`app/quiz/[id]/page.tsx`) — no prior story exercised Next.js 15's async `params` API; see Task 1's callout.
- **No git history exists to mine** — none of Epic 1/2's stories have been implemented yet (repo has no `apps/` source code beyond Story 1.1's package.json/tsconfig stubs), so there is no committed code or diff to inherit patterns from beyond what each story file specifies.
- Story 2.7 also flagged (and left unresolved for downstream stories) a `md`-vs-`lg` breakpoint ambiguity between `epics.md` and the UX artifacts. That ambiguity was **corrected 2026-07-20**: `epics.md`'s "Shared UI conventions" section now states `lg` (1024px) governs the result page and history sidebar, and explicitly carves out `/quiz/[id]` as having no structural breakpoint at all. This story is unaffected either way (see the resolved note above) but is recorded here in case the correction wasn't yet visible when this story was read.

### Testing standards summary

- Vitest component tests (Task 9) — extend Story 2.7's existing `apps/web` Vitest project; no new test runner.
- No Playwright work in this story — `full-quiz.spec.ts` is Story 5.2.
- `pnpm --filter @ai-quiz/web test` must be green before marking done; `pnpm verify` remains the overall gate.

### Project Structure Notes

New files:

```
apps/web/
  app/
    quiz/
      [id]/
        page.tsx                          NEW — thin async Server Component, awaits `params`
  components/
    quiz/
      quiz-runner.tsx                     NEW — 'use client'; fetch, status branching, answer state
      question-card.tsx                   NEW
      answer-option.tsx                   NEW
      progress-indicator.tsx              NEW
      shortfall-note.tsx                  NEW
      quiz-pending-state.tsx              NEW — see Dev Notes re: the pending-state gap
  lib/
    queries.ts                            UPDATE (Story 2.7) — add sessions.detail + submit hooks
```

Do **not** create `apps/web/app/result/`, `apps/web/components/history/`, or `apps/web/lib/sanitize.ts` in this story — see Scope Boundary.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3: Quiz-taking UI (one question at a time)] — the binding ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 3: Take the quiz & get graded results with insights] — epic ordering note (backend → result shell → quiz UI, no forward dependency)
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements → Shared UI conventions] — `lg`/`md` breakpoint correction (2026-07-20) and the explicit `/quiz/[id]` no-breakpoint carve-out
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-5, #FR-17, #NFR-5 · 10.5] — quiz UI, complete-submissions rule, FE state
- [Source: .../ARCHITECTURE-SPINE.md#AD-17 — FE state split] — TanStack Query + Context, no Zustand/Redux, UUID-before-hydration
- [Source: .../ARCHITECTURE-SPINE.md#AD-N5 — Complete submissions only] — exact-ID-set + non-empty-selected 400 rules
- [Source: .../ARCHITECTURE-SPINE.md#AD-15 — Submit idempotency + inline results] — 200/409 semantics, `actualCount`
- [Source: .../ARCHITECTURE-SPINE.md#AD-3 — Zod DTOs, wire schema ≠ row schema] — `RedactedQuestionSchema` requirement
- [Source: .../ARCHITECTURE-SPINE.md#AD-N4 — Question pool + stratified selection] — `actualCount` shortfall ladder
- [Source: .../ARCHITECTURE-SPINE.md#Deferred → Wire-projection ownership for questions (N6)] — open item this story consumes cautiously
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.5 Data Model, #A.6 REST API, #A.11 UI] — `questions`/`answers` shapes, endpoint list, page inventory
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/DESIGN.md#Components, #Colors, #Typography, #Layout & Spacing] — answer-option spec, focus ring, no-red rule
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/EXPERIENCE.md#Information Architecture, #Component Patterns, #State Patterns, #Interaction Primitives, #Accessibility Floor, #Responsive & Platform, #Trust & Disclosure] — quiz-runner states, gating rule, shortfall copy, no-polling decision, per-surface breakpoint table
- [Source: _bmad-output/project-context.md#Frontend state, #Scoring Rules] — state substrate rules, `weightedFinalScore` contiguous-position invariant this story's gating preserves
- [Source: _bmad-output/implementation-artifacts/2-7-landing-page-and-quiz-start-flow.md] — FE substrate this story extends verbatim (api.ts, queries.ts, states/, design tokens, motion stack)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
