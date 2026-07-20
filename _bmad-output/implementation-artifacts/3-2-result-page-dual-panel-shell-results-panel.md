# Story 3.2: Result page (dual-panel shell + results panel)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a result page showing my score, per-category breakdown, and study insights,
so that I understand my performance at a glance.

## Acceptance Criteria

_(FR-7 display, AD-15, AD-17, AD-21; UX: DESIGN.md, EXPERIENCE.md; epics.md Story 3.2 + Shared UI conventions, corrected 2026-07-20)_

1. **Route renders the shell.** Given `/result/[id]`, then it renders a shell composed of a **results panel** and a **chat panel slot** (the Epic 4 mount point) — at `≥ lg` (1024px) as a **dual-panel layout** (results ≈58% / chat ≈42%, separated by `{spacing.panel-gutter}`), with the results panel in normal document flow (the page scrolls) and the chat slot `sticky` in the viewport; below `lg` as a **`Tabs` control** (`Results` / `Chat`), Results active by default.
2. **`lg` is the only structural breakpoint here.** Given the shell's responsive behavior, then it is driven **exclusively** by Tailwind's built-in `lg` token (`--breakpoint-lg`, 1024px) — never `md` (768px), and never a hardcoded pixel value or arbitrary variant. This is the corrected rule (epics.md, 2026-07-20): `md` is reserved for non-structural stacking elsewhere (landing form, history list) and governs nothing on this page.
3. **Data fetch + loading state.** Given a valid session id, then a query hook fetches `GET /api/sessions/:id` with `X-User-Id`; while pending, the page shows a skeleton (score/chips/breakdown placeholders) — never a blank page, never a bare spinner.
4. **Not found / not owned.** Given a 404 response (cross-user or nonexistent — indistinguishable by design per FR-8), then the page shows "This session isn't available." with no dual-panel/tabs chrome and no hint that the session exists.
5. **Only `submitted` sessions render here.** Given a session whose status is `ready`, `pending`, or `failed`, then the page redirects to `/quiz/[id]` without rendering any result content — Story 3.3 already owns the correct per-status UI there (resume `ready`/`pending`, error+retry for `failed`), so this avoids duplicating that logic. `/result/[id]` renders content only for `status='submitted'`.
6. **Score display.** Given a submitted session, then the results panel shows `finalScore` via `{typography.score}` (56px/600, neutral `{colors.ink}` — **never** a strength color) with an animated count-up (~800ms ease-out); `prefers-reduced-motion` renders the final value immediately with no animation.
7. **Category strength chips.** Given `categoryBreakdown[]`, then every category with ≥1 question renders a `{components.strength-chip}` — solid strength-scale fill, white text, **always carrying its literal label** (`strong`/`mixed`/`weak`). A category absent from `categoryBreakdown[]` (0-question) is never rendered.
8. **Per-question breakdown, plain text only.** Given `breakdown[]` joined to each question's text/answers, then each question renders its text and its 4 answers in **server order** (never re-shuffled client-side), with the correct answer(s) marked and — where the payload carries it — the user's own selection marked. Question and answer text render as **plain text** (`{text}` auto-escaping) — **never** markdown or HTML, regardless of what the source document contained.
9. **Insights render inline; no separate trigger.** Given `insights` (`topicsToStudy[]`, `weakCategories[]`), then the results panel shows an insight narrative section **inline** on the same render — no "Analyze gaps" button, no insight endpoint call, ever (FR-12/FR-13 removed).
10. **Chat panel slot — the Epic 4 mount seam.** Given the chat region (right column at `≥lg`; "Chat" tab below it), then it renders a disabled/placeholder chat-slot component at the **exact** location Story 4.3 will mount the real chat panel into — no live network call, no message input, no thread. The slot receives `sessionId` as a prop so 4.3 can wire itself in without touching the results panel or the shell's layout logic.
11. **Single-mount panels (technical guardrail).** Given the responsive switch between dual-panel and tabs, then the results panel and the chat slot each mount **exactly once** in the DOM at all viewport widths — the switch is implemented as a CSS/state visibility toggle on one tree, never as two separate JSX subtrees (one for "mobile tabs", one for "desktop grid"). See Dev Notes for why this matters and the concrete pattern to use.
12. **`data-testid` coverage.** Given every interactive element (tab triggers, and any other control this story adds), then it carries `data-testid`; tests use `getByTestId(...)` only. The enforcing lint rule (`@ai-quiz/require-data-testid`) remains Story 5.2's, per the Story 1.1/2.7 precedent — this story applies attributes by hand.
13. **Accessibility floor.** Given the page, then it has exactly one `<h1>`, focus moves to it on route entry, tab triggers are keyboard-operable (Radix `Tabs` defaults), and a visible 2px `{colors.accent}` focus ring (2px offset) appears on every focusable element.
14. **Voice & tone.** Given any copy this story introduces (not-found, insight narrative framing), then it follows EXPERIENCE.md's Voice and Tone rules — second person, present tense, no exclamation marks, no emoji, no gamification language; a weak category is stated as a fact, never as a mark against the user.
15. **Tests.** Given the shell's responsive/tab visibility logic and the results-panel's data-to-view mapping (score, chips, per-question zipping, insights, 404, non-submitted redirect), then Vitest component tests cover it. Full Playwright assertions on this page (`full-quiz.spec.ts`) are Story 5.2's — see Scope Boundary.

## Tasks / Subtasks

- [ ] **Task 1 — Route scaffold** (AC: #1, #3)
  - [ ] `apps/web/app/result/[id]/page.tsx` — server component; reads `id` from `params`, renders a client component that owns data fetching and status branching.
  - [ ] Do **not** create or modify `apps/web/app/quiz/` — that is Story 3.3.
- [ ] **Task 2 — Session query hook** (AC: #3)
  - [ ] Extend `apps/web/lib/queries.ts`'s existing factory (established by Story 2.7: `queryKeys.providers`, `queryKeys.sessions.*`) with `queryKeys.sessions.detail(id)` and a `useSessionQuery(id)` hook calling `GET /api/sessions/:id` through the shared `lib/api.ts` wrapper (X-User-Id injection + error-envelope parsing already built).
  - [ ] The exact response shape for a `submitted` session (does `GET /sessions/:id` nest full question/answer text alongside `breakdown`/`categoryBreakdown`/`insights`, and does it carry each response's `selected` positions?) is **not fully pinned upstream** — see Dev Notes → "API contract this story consumes." Story 3.1 is being authored concurrently and owns the real Zod schema in `packages/shared/src/schemas.ts`. Build against the documented working assumption below, and **coordinate the exported schema/type name with Story 3.1 during implementation** rather than guessing it — do not fork a duplicate schema.
- [ ] **Task 3 — Status branching** (AC: #3, #4, #5)
  - [ ] In the client component: `pending` query state → skeleton; `404` → not-found message (no chrome); session status `submitted` → render the shell; any other status (`ready`/`pending`/`failed`) → `router.replace('/quiz/' + id)`.
- [ ] **Task 4 — Responsive shell** (AC: #1, #2, #11, #12)
  - [ ] Add `apps/web/components/ui/tabs.tsx` (shadcn `Tabs` — first consumer in this repo).
  - [ ] `apps/web/components/result/result-page-shell.tsx` — mounts `ResultsPanel` and `ChatPanelSlot` **exactly once each**. Drive the dual-panel/tabs switch with a single tree (see Dev Notes → "Single-mount responsive pattern" for the exact technique — do not duplicate the subtree).
  - [ ] `≥lg`: CSS grid, results column ≈58%, chat column ≈42%, gap = `{spacing.panel-gutter}` (32px); chat column `sticky` to the viewport top with its own scroll region; results column in normal flow.
  - [ ] `<lg`: `TabsList` (Results/Chat) visible and sticky to the top of the viewport; only the active tab's panel is visible.
  - [ ] Consume Tailwind's built-in `lg` token only — no `md:` classes, no arbitrary variants, no JS `matchMedia`/viewport detection anywhere in this component.
- [ ] **Task 5 — Results panel composition** (AC: #6, #7, #8, #9)
  - [ ] `apps/web/components/result/score-display.tsx` — `{typography.score}` count-up via `motion/react` (not `framer-motion`); `prefers-reduced-motion` → final value immediately, no animation.
  - [ ] `apps/web/components/result/strength-chip.tsx` — `{components.strength-chip}`; always renders its literal label.
  - [ ] `apps/web/components/result/category-breakdown.tsx` — maps `categoryBreakdown[]` → `StrengthChip` per category (skip 0-question categories — there should be none in the payload, but never render one anyway).
  - [ ] `apps/web/components/result/question-breakdown-item.tsx` + `question-breakdown-list.tsx` — plain-text question/answer render (`{text}`, no `dangerouslySetInnerHTML`, no markdown parser); correct answer(s) marked; user's selection marked when the payload provides it (guard for its absence — see Dev Notes).
  - [ ] `apps/web/components/result/insights-panel.tsx` — renders `insights.topicsToStudy[]` narrative + `insights.weakCategories[]`, capped at `{spacing.reading-measure}` (68ch); render defensively — `topicsToStudy[]`'s element shape is not yet pinned upstream (architecture spine "Deferred" N8), so treat unexpected/missing fields as absent rather than throwing.
  - [ ] `apps/web/components/result/results-panel.tsx` — composes the above; no "Analyze gaps" trigger anywhere.
  - [ ] `apps/web/components/result/results-panel-skeleton.tsx` — loading placeholder built from the shadcn `Skeleton` primitive (already added by Story 2.7).
- [ ] **Task 6 — Chat panel slot** (AC: #10, #11)
  - [ ] `apps/web/components/result/chat-panel-slot.tsx` — disabled/placeholder only; accepts `sessionId`; no fetch, no input, no thread. This is the file Story 4.3 replaces the internals of (or swaps out) — see Dev Notes → "Chat mount seam."
- [ ] **Task 7 — Not-found copy** (AC: #4)
  - [ ] Extend `apps/web/lib/error-copy.ts` (built by Story 2.7, left extensible on purpose) with the 404 entry: "This session isn't available." Reuse the existing generic empty/error state component for the message — do not fork a new one-off component for this single case.
- [ ] **Task 8 — Accessibility pass** (AC: #13)
  - [ ] Single `<h1>`; focus moves to it on route entry (client-side navigation and hard load both).
  - [ ] Verify Radix `Tabs` default keyboard behavior (arrow-key switch, `Home`/`End`) is intact — do not override it.
  - [ ] Confirm the 2px `{colors.accent}` focus ring (already global via Story 2.7's `@theme` wiring) renders on tab triggers.
- [ ] **Task 9 — Voice & tone pass** (AC: #14)
  - [ ] Not-found copy and any insight-narrative framing text follow EXPERIENCE.md's Voice and Tone table — no editorializing on the score, no blame language.
- [ ] **Task 10 — Tests** (AC: #15)
  - [ ] Vitest component tests (same tooling Story 2.7 added under `apps/web`'s Vitest project): shell renders both panels exactly once regardless of simulated width; tab visibility toggling logic; results-panel data-to-view mapping against a fixture `submitted` payload (score, chips per category, per-question zip, insights); insights-panel renders without throwing on a minimal/partial `topicsToStudy` fixture; 404 path renders the not-found message with no chrome; non-`submitted` status triggers the redirect call.
  - [ ] Full Playwright `full-quiz.spec.ts` assertions on this page are **out of scope** — Story 5.2.
  - [ ] Run `pnpm --filter @ai-quiz/web test` before marking done.

## Dev Notes

### 🚨 Scope boundary — read first

| Belongs to | NOT this story | Why |
|---|---|---|
| **Story 3.1** | `POST /api/sessions/:id/submit` (scoring, persistence, idempotency), the real `GET /api/sessions/:id` backend implementation, `insights`/`categoryBreakdown` computation | 3.1 owns the results API contract end to end. This story is a pure consumer — it must not compute scores, aggregate categories, or derive insights client-side. |
| **Story 3.3** | `/quiz/[id]` page content, answering flow, the `POST /submit` call itself | This story assumes a session is *already* `submitted` by the time `/result/[id]` is reached; it does not produce that state. |
| **Story 4.3** | The real chat panel (thread rendering, "view older", message input, "Explain Qn" control + its behavior, `lib/sanitize.ts` DOMPurify wrapper) | This story builds only the **empty/disabled mount slot** — see "Chat mount seam" below. "Explain Qn" is deliberately **not** built here; its entire purpose is to act on a chat input that does not exist until 4.3. |
| **Story 5.1** | History sidebar | Not applicable to this page at all — per EXPERIENCE.md's Information Architecture table, the history sidebar lives **only** on `/` (landing). `/result/[id]` has no sidebar. Do not add one. |
| **Story 5.2** | `apps/web/e2e/` Playwright suite, `full-quiz.spec.ts` result-page assertions, the **enforcing** `@ai-quiz/require-data-testid` lint rule | This story adds `data-testid` attributes by hand and Vitest component tests only. |
| **Epic 1 (done)** | `lib/api.ts` (X-User-Id injection, error-envelope parsing), the `{error:{code,message,requestId}}` shape itself, CORS/rate-limit enforcement | Already built (Story 1.5); this story only consumes it. |
| **Story 2.7 (done)** | FE substrate (`@theme` tokens, TanStack Query setup, `UserProvider`, `components/states/*`, `lib/api.ts`, `lib/queries.ts` factory, `lib/error-copy.ts`) | Already stood up. Extend these, don't recreate or fork parallel versions. |

### ⚠️ Breakpoint resolution — follow this, do not re-litigate

Three artifacts disagree on the collapse breakpoint for this exact layout, and the disagreement is **already resolved** in favor of `lg` = 1024px:

- **`ARCHITECTURE-SPINE.md` AD-21** (dated 2026-07-19) says collapse at `md` = 768px and is the single structural breakpoint. **This is stale** — it predates the UX artifacts landing later the same day and was never re-synced.
- **`DESIGN.md`** and **`EXPERIENCE.md`** (both `status: final`, dated 2026-07-19) are explicit: *"The `lg` (1024px) boundary is the one that matters — it is where the dual panel collapses to tabs and where the sidebar becomes a sheet."* `md` only governs the landing form and history-list stacking.
- **`epics.md`** was corrected 2026-07-20 to match DESIGN.md/EXPERIENCE.md — its "Shared UI conventions" section now states `lg` = 1024px is the structural breakpoint. The **literal AC text under the Story 3.2 heading in epics.md still says `md` (768px)** — that line was missed in the correction pass. Follow the corrected shared-conventions rule (`lg`), not the uncorrected literal AC line; this is the same resolution Story 2.7 flagged forward and left unresolved for this story to pick.

**This story's binding rule:** `lg` = 1024px is the only structural breakpoint on `/result/[id]`. Consume Tailwind's built-in `lg` token (`--breakpoint-lg`, `64rem`); do not redeclare it (Tailwind 4 theme tokens live in CSS `@theme`, already wired by Story 2.7). `md` governs nothing here. **Flag forward:** `ARCHITECTURE-SPINE.md` AD-21 should be corrected to match epics.md/DESIGN.md/EXPERIENCE.md in a future architecture pass — this story does not edit the spine, but a dev/reviewer should not treat AD-21's `md` text as current.

### ⚠️ Single-mount responsive pattern — read before building the shell

A dual-panel-vs-tabs collapse is easy to implement by rendering **two separate JSX subtrees** (one desktop grid, one mobile `Tabs`) and hiding one with CSS. **Do not do this.** It duplicates every `data-testid` inside the results panel and chat slot into two DOM nodes, which breaks Playwright's `getByTestId()` (strict-mode violation: locator resolves to 2+ elements) the moment Story 5.2 writes `full-quiz.spec.ts` against this page.

**Use one tree.** Mount `ResultsPanel` and `ChatPanelSlot` exactly once. Recommended technique: wrap both in Radix `Tabs.Content` with `forceMount` (keeps both mounted regardless of active tab, Radix toggles a `data-state` attribute instead of unmounting), then style visibility with Tailwind:
- Base (mobile-scoped): `data-[state=inactive]:hidden` — only the active tab's panel shows below `lg`.
- `lg:` override: force both panels visible regardless of `data-state` (e.g. `lg:data-[state=inactive]:block lg:grid` on the container, or an equivalent override that neutralizes the mobile-scoped `hidden`).

This also means **no JS `matchMedia`/viewport-detection hook is needed anywhere in this story** — the switch is pure CSS driven by Tailwind's `lg:` variant plus Radix's existing `data-state`. Do not add a `useIsDesktop()`-style hook; it would introduce a hydration-mismatch risk this pattern avoids entirely.

### Chat mount seam (for Story 4.3)

`apps/web/components/result/chat-panel-slot.tsx` is the **file** Story 4.3 owns rewriting. Its contract:
- Props: `{ sessionId: string }` — nothing else. 4.3 will add whatever it needs internally (thread query, message mutation) without changing this prop shape or where `ResultPageShell` mounts it.
- `ResultPageShell` renders `<ChatPanelSlot sessionId={id} />` in exactly one place in the tree (per the single-mount pattern above) — 4.3's AC ("mounts into the existing chat slot without rewriting the results panel") depends on this call site not moving.
- This story's placeholder content: a disabled/neutral state occupying the chat region — no network call, no input, no thread rendering, `data-testid="chat-panel-slot"`. Exact placeholder copy is not specified upstream; keep it minimal and on-voice (no "coming soon" gamification language) if any text is shown at all.
- The **"Explain Qn" control is not built in this story** — it is listed under Story 4.3's AC in epics.md ("Given the 'Explain Q3' control on a question, When clicked, Then it pre-fills the chat input…") and has no destination without a real chat input. Do not add an inert button for it here; 4.3 adds both the control and its behavior when it mounts the real chat panel. If a future story disagrees with this reading, correct it in 4.3, not silently here (same convention Story 2.7 used for its own resolved-conflict notes).

### API contract this story consumes (working assumption — confirm against Story 3.1's schema)

Per PRD FR-7 / AD-15, `POST /submit` returns:
```ts
type SubmitResponse = {
  sessionId: uuid;
  finalScore: number;              // 0..4
  breakdown: QuestionResult[];     // questionId, position, rawScore, weight, weightedScore, correctAnswers
  categoryBreakdown: CategoryPerformanceDto[]; // name, questionCount, correctCount, avgRawScore, weightedScore, strength
  insights: {
    topicsToStudy: { topic: string; reason: string; docSnippets: string[] }[];
    weakCategories: string[];
    strengthByCategory: 'strong' | 'mixed' | 'weak';  // per PRD text this is "per-category" but typed as a single enum — likely a spec typo; do not build a UI dependent on it
  };
};
```
Per Story 3.1's AC (epics.md), `GET /sessions/:id` on a `submitted` session "returns results + insights" — i.e., the same data. **What is not pinned upstream:** whether that combined response also nests each question's full text/answers (with `is_correct` now revealed) and each response's `selected` positions, which the results panel needs to render anything beyond bare scores. The architecture spine's own "Deferred" list (N6, "Wire-projection ownership for `questions`") flags exactly this gap as open, to be resolved during Story 3.1.

**This story's working assumption:** the `submitted` payload from `GET /api/sessions/:id` includes the full question set (text, type, category, all 4 answers with `is_correct`) alongside `finalScore`/`breakdown`/`categoryBreakdown`/`insights`, joinable by `questionId`. Build `question-breakdown-item.tsx` to zip `breakdown[]` with the question/answer data by `questionId`. For the user's own selected positions, treat the field as **optional** — if the actual payload doesn't carry `selected` per response, the breakdown still shows question text, all 4 answers, and which are correct, just without a "you picked this" mark. **Coordinate the exact field names/schema export with Story 3.1 during implementation** — these two stories are being authored concurrently; do not let this story's assumption silently diverge from what 3.1 actually ships. Use `categoryBreakdown[].strength` (not `insights.strengthByCategory`) for the strength chips — it is the unambiguous field.

### Design tokens (`DESIGN.md`) — already wired by Story 2.7, consume only

Story 2.7's Task 2 wired the full `@theme` token set into `apps/web/app/globals.css`, including tokens this story is the **first to consume**: `score` typography (56px/600/1/-0.02em, `{colors.ink}`), `strength-strong/mixed/weak` (+ `-dark` pairs, + `strength-foreground`), `panel-gutter` (32px), `reading-measure` (68ch), `rounded.full` (strength chips). Do not re-declare any `@theme` block — if a token appears to be missing, that's a Story 2.7 gap to flag, not something to fix here by adding a second `@theme` declaration.

| Token | Light | Dark |
|---|---|---|
| `strength-strong` (moss) | `#4A7C59` | `#86B894` |
| `strength-mixed` (ochre) | `#8A6420` | `#DCB46A` |
| `strength-weak` (clay) | `#A8574B` | `#D89185` |
| `strength-foreground` | `#FFFFFF` | `#1A1815` |
| `ink` | `#2A2723` | `#EDE9E2` |
| `primary` | `#3F6B7D` | `#8FB8CC` |

**Never** substitute red for `strength-weak` — clay is deliberate (a wrong-answer signal is information, not an alarm). Strength chips are **solid fill + white/dark text**, never tinted-background-with-colored-text (fails AA on sunken surfaces per DESIGN.md § Colors). Score display uses `{colors.ink}`, **never** a strength color — the number is neutral, categories carry the diagnosis.

**Motion:** `motion` 12.42.2 from `motion/react` (not `framer-motion`), matching Story 2.7's precedent. The score count-up is "the one genuinely expressive moment in the product" (EXPERIENCE.md) — do not add other celebratory motion.

### Component behavioral contracts (`EXPERIENCE.md` § Component Patterns)

- **Answer option / breakdown row:** exactly 4 options at positions 0–3, always in server order — never client-shuffled, or breakdown positions stop matching the session.
- **Plain text is a security control, not styling** (AD-N1): `{text}` auto-escaping on question/answer text is load-bearing. Do not run any markdown/HTML renderer on it, even though `DOMPurify` exists elsewhere in the product (scoped to explanations + chat only — neither of which this story renders).
- **Strength chip:** always carries its literal label; rendered only for categories with ≥1 question.
- **Score display:** `{typography.score}`, animated count-up, neutral ink.
- **Insight narrative voice:** states facts plainly per the Voice and Tone table — e.g. "You scored 1.5/4 on WebSockets" not "Oops! WebSockets tripped you up! 😅". No exclamation marks, no emoji.

### State patterns this story owns (`EXPERIENCE.md` § State Patterns → `/result/[id]`)

- *Loading* — skeleton for score, chips, and breakdown.
- *Loaded* — score count-up, chips, breakdown, inline insights.
- *Chat slot empty* — "pre-Epic-4 shell contract (story 3.2)" — this is this story's literal deliverable for the chat region, named explicitly in EXPERIENCE.md.
- **Not this story's states:** *409 on submit* and *duplicate submit* are listed under `/result/[id]` in EXPERIENCE.md's state table but both describe outcomes of the `POST /submit` call itself, which happens on `/quiz/[id]` (Story 3.3) before the user ever navigates here — they are 3.3's states to handle, not this page's.

### Previous story intelligence (Story 2.7 — FE substrate, first UI story)

No frontend code exists yet beyond what Story 2.7 specifies (it has not been implemented, only authored — same as this story). Story 2.7 establishes, and this story must reuse rather than reinvent:
- `apps/web/lib/api.ts` — the single fetch wrapper; attaches `X-User-Id`, parses `{error:{code,message,requestId}}`.
- `apps/web/lib/queries.ts` — the query-keys factory; this story **extends** it (`queryKeys.sessions.detail`), never forks a parallel factory.
- `apps/web/components/states/` — `ErrorState`, `EmptyState`, `RateLimitedState`, `NarratedWait` all already exist by the time this story runs. Reuse `ErrorState` or `EmptyState` for the not-found message (Task 7) rather than building a new one-off component — this is the binding "shared empty/loading/error state components" convention from epics.md's Additional Requirements.
- `apps/web/lib/error-copy.ts` — already exists, deliberately left extensible for 404/409 by Story 2.7's own dev notes ("leave room for codes other stories will add… without this story needing to handle them"). This story is that "other story" for 404.
- `apps/web/components/ui/` — shadcn primitives `Button`, `Input`, `Select`, `RadioGroup`, `Skeleton`, `Card` already exist. This story adds `Tabs` as the first new primitive since 2.7.
- Design tokens, dark-mode wiring, and the general `@theme` CSS-first Tailwind 4.3.3 setup are already done — see "Design tokens" above.

### Testing standards summary

- Vitest component tests (Task 10) — same tooling/project Story 2.7 adds under `apps/web`'s Vitest config; do not add a second test runner.
- No Playwright work in this story — `full-quiz.spec.ts` assertions against `/result/[id]` are Story 5.2's.
- `pnpm --filter @ai-quiz/web test` must be green before marking done; `pnpm verify` remains the overall gate.

### Project Structure Notes

New files (building on the `apps/web` tree Story 2.7 establishes):
```
apps/web/
  app/
    result/
      [id]/
        page.tsx                        NEW — server component, extracts `id`
  components/
    result/
      result-page-client.tsx            NEW — query + status branching (loading/404/redirect/loaded)
      result-page-shell.tsx             NEW — single-mount dual-panel/tabs responsive shell
      results-panel.tsx                 NEW — composition root
      results-panel-skeleton.tsx        NEW
      score-display.tsx                 NEW
      strength-chip.tsx                 NEW
      category-breakdown.tsx            NEW
      question-breakdown-list.tsx       NEW
      question-breakdown-item.tsx       NEW
      insights-panel.tsx                NEW
      chat-panel-slot.tsx               NEW — Epic 4 mount seam
    ui/
      tabs.tsx                          NEW — shadcn Tabs (first consumer)
  lib/
    queries.ts                          UPDATE (Story 2.7) — add queryKeys.sessions.detail + useSessionQuery
    error-copy.ts                       UPDATE (Story 2.7) — add 404 entry
```
Do **not** create `apps/web/app/quiz/`, `apps/web/components/history/`, or `apps/web/lib/sanitize.ts` in this story — see Scope Boundary.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2: Result page (dual-panel shell + results panel)] — binding ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 3: Take the quiz & get graded results with insights] — epic ordering note: backend (3.1) → result shell (3.2) → quiz UI (3.3), so no story depends on a later one
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements → Shared UI conventions] — `lg` = 1024px structural breakpoint (corrected 2026-07-20), `data-testid` convention, `components/states/` reuse convention
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-7, #FR-17, #NFR-8] — `SubmitResponse` shape, idempotency, scoring invariants
- [Source: .../ARCHITECTURE-SPINE.md#AD-15 — Submit idempotency + inline results+insights] — single-response shape, 409 vs 200 semantics
- [Source: .../ARCHITECTURE-SPINE.md#AD-17 — FE state split] — TanStack Query + Context, no Zustand/Redux
- [Source: .../ARCHITECTURE-SPINE.md#AD-21 — Single responsive breakpoint] — **stale relative to epics.md's 2026-07-20 correction**; this story follows the corrected `lg` rule, see Dev Notes
- [Source: .../ARCHITECTURE-SPINE.md#Deferred → "Wire-projection ownership for questions" (N6), "insights writer + topicsToStudy shape" (N8)] — open upstream gaps this story builds defensively against
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.5 Data Model, #A.6 REST API, #A.9 Scoring Module, #A.11 UI] — schema field names, `GET /sessions/:id` / `POST /submit` shapes, result-page description (dual-panel, "Explain Qn" — resolved to Story 4.3 here)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/DESIGN.md] — `score`/strength-chip tokens, panel-gutter, reading-measure, breakpoint table (`lg` is structural), motion stack
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/EXPERIENCE.md#Information Architecture, #Component Patterns, #State Patterns, #Responsive & Platform, #Accessibility Floor] — IA (no sidebar on this route), plain-text render rule, per-surface states, dual-panel/tabs behavior, a11y floor
- [Source: _bmad-output/project-context.md#Frontend state, #Security Rules] — state substrate rules, plain-text Q/A rendering as a security control
- [Source: _bmad-output/implementation-artifacts/2-7-landing-page-and-quiz-start-flow.md] — FE substrate this story builds on (`lib/api.ts`, `lib/queries.ts`, `components/states/*`, `lib/error-copy.ts`, `@theme` tokens); its own flagged-forward breakpoint conflict, resolved here
- [Source: _bmad-output/implementation-artifacts/1-5-network-hardening-rate-limiting-cors-helmet-error-shape.md] — `{error:{code,message,requestId}}` envelope, 404-not-403 semantics this page's not-found state relies on

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
