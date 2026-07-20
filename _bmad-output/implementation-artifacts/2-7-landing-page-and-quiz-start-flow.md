# Story 2.7: Landing page & quiz start flow

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to paste a URL, pick a provider and strategy, and start,
so that I reach a playable quiz.

## Acceptance Criteria

_(FR-5 start, FR-14, NFR-5, AD-17; UX: DESIGN.md, EXPERIENCE.md)_

1. **FE substrate wired.** Given a working `apps/web` Next.js 15 App Router app, then Tailwind 4.3.3 (CSS-first `@theme` tokens, **not** `tailwind.config.js` idioms), shadcn/ui, TanStack Query v5 (query-keys factory in `apps/web/lib/queries.ts`), React Context for UUID identity + theme, and a `useLocalStorage` hook are all wired. No Zustand, no Redux, anywhere in the tree.
2. **UUID generated before hydration.** Given `app/layout.tsx`, then an inline `<head>` script calls `crypto.randomUUID()` and persists it to `localStorage` **before** React hydrates; `UserProvider` reads that value on mount. No surface may render an identity-dependent state that could flash or mismatch on first paint.
3. **Every request carries identity.** Given `apps/web/lib/api.ts` (the fetch wrapper), then every request to the API attaches `X-User-Id` from the UUID context — no request goes out without it.
4. **Landing form renders the full field set.** Given `/`, then it renders: a URL input, an optional `topic` hint (≤200 chars), a **required** strategy picker (`factual` | `comprehension` | `mixed` | `trivia`, **no pre-selection**), a provider→model **dependent** select pair populated from `GET /api/config/providers`, a `questionCount` control (integers 5–8, default 8), and a Start button — every interactive element carries `data-testid`.
5. **Provider/model dependency.** Given the provider select changes, then the model select resets to that provider's default model; the model select's option set is always scoped to the currently chosen provider.
6. **Start gating.** Given the form, then Start is disabled until the URL and strategy are both valid; `Enter` submits the form when valid; next/submit-style gating is a UI convenience only (server remains authoritative, per FR-17's precedent).
7. **Happy path submit.** Given Start is clicked with a valid URL + strategy, then it `POST`s `/api/sessions` with `X-User-Id` and the full request contract (`sourceUrl`, `topic`, `strategy`, `questionCount`, `provider`, `model`); on a `status='ready'` response it invokes the router to `/quiz/[id]`. The destination page's content is Story 3.3's — within Epic 2 this AC is satisfied by asserting the POST succeeds and the router is invoked with the correct `/quiz/[id]` path (Epic 2 seam, per epics.md).
8. **In-flight narration.** Given Start is clicked and the request is in flight (5–30s typical, sync HTTP, no polling), then Start and all form controls are disabled for the duration, and a non-blocking, client-timer-driven, indeterminate narration advances **forward-only** through: `0s` "Fetching the document…", `~3s` "Reading it through…", `~8s` "Writing your questions…", `~20s` "Almost there — longer documents take a little more thought." Never a bare spinner, never a determinate progress bar. `prefers-reduced-motion` swaps the animation for static text while the stage copy still advances (it is information, not decoration).
9. **Generation failure.** Given a generation failure (a 5xx, an `UntrustedLlmOutputError`-driven `status='failed'`, or a 400 `DOC_TOO_LARGE`/`DOC_TOO_SHORT`/SSRF-blocked/invalid-URL response), then the UI shows human-readable copy (mapped from `error.code`, never the raw code or a stack trace) with a **Retry** button that resubmits the preserved form values — never an infinite spinner.
10. **429 rate-limited state.** Given a `429` response with `Retry-After` (`POST /api/sessions` is capped at 5/min per NFR-2, reachable by a user retrying a failed generation), then the UI shows "You're going a bit fast. Try again in {n} seconds." and re-enables Start automatically once the wait elapses — never a generic failure message.
11. **No providers configured.** Given `GET /api/config/providers` returns `[]` (no provider env keys set), then the landing page shows an explicit "no providers configured" message and disables Start with that explanation — never an empty dropdown behind a live button.
12. **Responsive reflow.** Given a viewport narrower than the shared `md` breakpoint (768px, Tailwind's stock scale), then the landing form reflows to single column with full-width controls; the breakpoint comes from Tailwind's theme, never a hardcoded media query or arbitrary value in this story.
13. **Voice, tone, and error copy.** Given any copy on this page (labels, narration, errors), then it follows EXPERIENCE.md's Voice and Tone rules — second person, present tense, no exclamation marks, no emoji, no gamification language — and error copy names the remedy, never the blame or a raw error code.
14. **Accessibility floor.** Given the page, then it has exactly one `<h1>`, labelled form controls with `aria-describedby` linking to errors, a visible 2px accent focus ring on every interactive element, narration/error announcements via `aria-live="polite"` (one announcement per stage change, not spammed), and correct semantics for the strategy/provider/model groups (`<fieldset>`/`<legend>` where applicable).
15. **`data-testid` coverage (attributes only).** Given every interactive element on `/`, then it carries `data-testid`. The **enforcing** ESLint rule `@ai-quiz/require-data-testid` is **not** built in this story — see Scope Boundary.
16. **Tests.** Given the form's client-side logic (gating, provider→model reset, narration stage sequencing, error-code→copy mapping, rate-limit countdown), then Vitest component tests cover it. Full Playwright E2E (`landing.spec.ts`) is **not** built in this story — see Scope Boundary.

## Tasks / Subtasks

- [ ] **Task 1 — Scaffold the actual Next.js app** (AC: #1)
  - [ ] Story 1.1 created only `apps/web/package.json` + `apps/web/tsconfig.json` stubs (explicitly out of scope for 1.1). **Read both before editing.** Add Next.js 15, Tailwind 4.3.3, `@tanstack/react-query` v5, shadcn/ui deps, `motion` (not `framer-motion`), and this story's own devDependencies (component-test tooling, see Task 9) to `apps/web/package.json`.
  - [ ] Create `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `next.config.ts`.
  - [ ] `apps/web/tsconfig.json` continues to extend `tsconfig.base.json` (Story 1.1) — do not restate `strict`/`noUncheckedIndexedAccess`/`noImplicitOverride`.
- [ ] **Task 2 — Wire the `@theme` design tokens** (AC: #1, #14)
  - [ ] In `app/globals.css`, declare the DESIGN.md brand-layer tokens under Tailwind 4's CSS-first `@theme` directive — colors (`surface-base/raised/sunken`, `ink`/`ink-muted`, `primary`, `accent`, `strength-*`, plus every `-dark` pair), typography roles (`reading`/`question`/`score`/`display`/`code`), `rounded` scale (`sm`/`md`/`lg`/`full`), and named spacing (`reading-measure`, `panel-gutter`, `card-padding`, `option-gap`). Exact values are in Dev Notes.
  - [ ] Do **not** override Tailwind's stock breakpoint scale (`sm`/`md`/`lg` already sit at 640/768/1024px) — use the `md:` variant directly, no custom `--breakpoint-*` token.
  - [ ] Wire dark mode via `prefers-color-scheme: dark` mapping to the `-dark` token set. No manual toggle UI is required by any AC — see Dev Notes.
- [ ] **Task 3 — FE state substrate** (AC: #1, #2, #3)
  - [ ] `apps/web/lib/user-context.tsx` — `UserProvider` + `useUserId()`; reads the UUID written by the `<head>` script.
  - [ ] `apps/web/lib/use-local-storage.ts` — generic persisted-prefs hook.
  - [ ] `apps/web/lib/theme-context.tsx` (or folded into one `providers.tsx`) — `ThemeProvider`; default follows `prefers-color-scheme`, persisted via `useLocalStorage` once a user override exists (no toggle control required by any current AC).
  - [ ] `apps/web/app/providers.tsx` (client component) — wraps `QueryClientProvider` + `UserProvider` + `ThemeProvider`; rendered from the server-component `layout.tsx`.
  - [ ] Inline `<head>` script in `layout.tsx`: `crypto.randomUUID()` → `localStorage`, guarded so it never overwrites an existing id.
  - [ ] `apps/web/lib/api.ts` — fetch wrapper reading `NEXT_PUBLIC_API_URL`, attaching `X-User-Id` on every call, parsing the `{error:{code,message,requestId}}` envelope (Story 1.5's shape) into a typed error the UI can map to copy.
  - [ ] `apps/web/lib/queries.ts` — query-keys factory (`queryKeys.providers`, `queryKeys.sessions.*`) + `useProvidersQuery()` + `useCreateSessionMutation()`.
- [ ] **Task 4 — Shared state components** (AC: #8, #9, #10, #11)
  - [ ] `apps/web/components/states/` — build these as **generic, reusable** components per the binding "Shared empty / loading / error state components" convention (epics.md Additional Requirements), not landing-specific:
    - `NarratedWait` — takes a stage list + timings as props (this story's generation copy; Story 3.1's submit-narration reuses it with different copy/timings).
    - `ErrorState` — takes mapped copy + retry callback.
    - `RateLimitedState` — takes `Retry-After` seconds, counts down, calls back when elapsed.
    - `EmptyState` — generic empty-state shell (used here for "no providers configured"; Story 5.1 reuses it for the empty history sidebar).
  - [ ] `apps/web/lib/error-copy.ts` — `error.code` → human copy map (table in Dev Notes). Landing only needs a subset; leave room for codes other stories will add (409, 404) without this story needing to handle them.
- [ ] **Task 5 — Landing form components** (AC: #4, #5, #6, #12, #13, #14, #15)
  - [ ] `apps/web/components/landing/session-form.tsx` — composes the fields; owns Start-gating state.
  - [ ] URL input, optional topic input (200-char cap enforced client-side), strategy picker (no pre-selected value — a controlled component with `undefined` initial state, not a default enum member), provider select → model select (resets model on provider change), `questionCount` select (5/6/7/8).
  - [ ] Reuse the shared Zod request schema for `POST /api/sessions` that Story 2.4 adds to `packages/shared/src/schemas.ts` for client-side validation — do not fork a duplicate schema (these stories are being authored concurrently; coordinate on the exported name during implementation).
  - [ ] Single `<h1>`, `<fieldset>`/`<legend>` for the strategy group, `aria-describedby` linking each field to its error.
  - [ ] `md:` responsive classes only; no bespoke media queries.
  - [ ] `data-testid` on every interactive element (input, both selects, strategy options, questionCount control, Start button, retry button, error message container).
- [ ] **Task 6 — Wire Start → submit → narrate → route** (AC: #7, #8)
  - [ ] `useCreateSessionMutation()` fires on Start; disables the whole form for the duration; mounts `NarratedWait` with the generation stage list.
  - [ ] On success (`status='ready'`): `router.push(`/quiz/${id}`)`. Do **not** build `/quiz/[id]`'s content — see Scope Boundary.
  - [ ] On failure: render `ErrorState` (mapped copy + Retry, form values preserved) or `RateLimitedState` for 429, per `error.code`/status.
- [ ] **Task 7 — Provider config fetch + empty state** (AC: #11)
  - [ ] `useProvidersQuery()` calls `GET /api/config/providers` (built by Story 2.3). Empty array → `EmptyState` "no providers configured" + Start disabled with explanation.
- [ ] **Task 8 — Accessibility pass** (AC: #14)
  - [ ] Focus ring token (`{colors.accent}`, 2px, 2px offset) on every focusable element.
  - [ ] `aria-live="polite"` region for narration stage changes and for the error/rate-limit surfaces — one announcement per change.
  - [ ] Verify 200% zoom, no horizontal scroll, on the landing form.
- [ ] **Task 9 — Tests** (AC: #16)
  - [ ] Add a component-testing setup (Vitest + `@testing-library/react` + `@testing-library/user-event`; jsdom environment) — no such tooling exists yet in the repo, this story is first to need it. Add to `apps/web`'s `vitest` project config (Story 1.1's `test.projects` root config), not a new top-level test runner.
  - [ ] Cover: Start disabled until URL+strategy valid; strategy has no default; provider change resets model; narration stages advance forward-only and never reset; error-code→copy mapping for each code in the table; 429 countdown re-enables Start at zero; empty-providers state disables Start.
  - [ ] Full Playwright `landing.spec.ts` + POM classes are **out of scope** — Story 5.2 builds them (epics.md Story 5.2 AC explicitly owns `landing.spec.ts`).
  - [ ] Run `pnpm --filter @ai-quiz/web test` before marking done.

## Dev Notes

### 🚨 Scope boundary — read first, this is the top risk on this story

This is the **first frontend story in the project** and sits directly upstream of four sibling Epic-2 stories (2.1–2.6, backend) plus every later UI story. Over-implementation here compounds into every one of them.

| Belongs to                          | NOT this story                                                                               | Why                                                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Story 3.3**                       | `/quiz/[id]` page content (question rendering, answer selection, prev/next, submit)          | Epic 2's exit is "the router is invoked with `/quiz/[id]`" — the page itself doesn't exist until Epic 3. Building it here duplicates Story 3.3's work under a different story number.                             |
| **Story 3.2**                       | `/result/[id]` page, dual-panel shell, results panel                                         | Not reachable from this story at all.                                                                                                                                                                             |
| **Story 4.3**                       | `apps/web/lib/sanitize.ts` (DOMPurify wrapper)                                               | DOMPurify is scoped to explanations + chat only (AD-N1) — this page renders neither. First story to need it builds it.                                                                                            |
| **Story 5.1**                       | History sidebar (session list, load-more, empty state, slide-out on mobile)                  | Explicitly owned by epics.md Story 5.1 ("Given the history sidebar on the landing page…"). Story 2.7's AC list in epics.md does **not** mention a history sidebar at all — only the session form. Do not add one. |
| **Story 5.2**                       | `apps/web/e2e/` Playwright suite, `landing.spec.ts`, POM classes (`BasePage`, `LandingPage`) | epics.md Story 5.2 AC explicitly: "Given `landing.spec.ts`, Then it covers URL entry, provider dropdown, strategy selection, and start." This story adds Vitest component tests only (Task 9).                    |
| **Story 5.2**                       | The **enforcing** ESLint rule `@ai-quiz/require-data-testid`                                 | See conflict note below — resolved in favor of Story 1.1's scope table.                                                                                                                                           |
| **Epic 1 (done)**                   | `apps/web/package.json`/`tsconfig.json` skeleton, root tooling, `pnpm verify` gate           | Already built by Story 1.1. Extend, don't recreate.                                                                                                                                                               |
| **Story 1.5 (done)**                | The `{error:{code,message,requestId}}` envelope shape, CORS, rate-limit _enforcement_        | This story only **consumes** the envelope and renders copy for it — it doesn't implement the server-side guard.                                                                                                   |
| **Story 1.4 (done)**                | `X-User-Id` server-side identity/ownership machinery                                         | This story is the **first to send** the header from a real browser — the receiving side (interceptor, RLS, 404-on-mismatch) is already built.                                                                     |
| **Story 2.3 (sibling, concurrent)** | `GET /api/config/providers` implementation                                                   | This story only calls it.                                                                                                                                                                                         |
| **Story 2.4 (sibling, concurrent)** | The `CreateSessionRequestSchema` Zod contract for `POST /api/sessions`                       | Reuse it (Task 5); do not fork a duplicate validation schema — these are being authored in parallel, so coordinate on the exported name during implementation rather than guessing it here.                       |

### ⚠️ Resolved conflict — `@ai-quiz/require-data-testid` is NOT built here

`project-context.md` and `epics.md`'s "Additional Requirements" section both say the rule lands "with the first UI stories" (generic phrasing) — which on its face would mean _this_ story, since Epic 2 (this story) ships before Epic 3's UI stories. **However**, Story 1.1 (already-written prior art) has an explicit scope-boundary table entry: `@ai-quiz/require-data-testid` → **"Epic 3+ UI stories / Story 5.2"**, and epics.md's own Story 5.2 AC explicitly claims "the CI lint rule rejects interactive elements lacking `data-testid`" as its deliverable. This story follows Story 1.1's narrower, explicit assignment: apply `data-testid` attributes by hand (AC #15) but do **not** implement or wire the ESLint rule. If a future story finds this reading wrong, it should be corrected in Story 1.1 or 5.2, not silently overridden here.

### ⚠️ Unresolved spec gap — responsive breakpoint value (flag forward, doesn't block this story)

`epics.md`'s "Shared UI conventions" section (binding on Stories 2.7, 3.2, 3.3, 5.1) states: _"Single responsive breakpoint: `md` = 768px. Below it the result page collapses dual-panel → tabs and the history sidebar collapses → slide-out."_ This story's AC #12 follows that literally.

`DESIGN.md` and `EXPERIENCE.md` (both `status: final`, updated 2026-07-19 — same day) define a **three-tier** scale (`sm` <640, `md` ≥768, `lg` ≥1024) and are explicit that **`lg` (1024px) is the structural boundary** — "it is where the dual panel collapses to tabs and where the sidebar becomes a sheet" — with `md` only governing the landing form/history stacking, not the dual-panel/sidebar collapse epics.md attributes to it.

**This does not block Story 2.7**: this story has no dual-panel or persistent sidebar (those don't exist until Stories 3.2 and 5.1), so AC #12 — single-column reflow of the form below `md` (768px) — is satisfiable under either reading without contradiction. **It does block Stories 3.2, 3.3, and 5.1**, which must pick one breakpoint for the tabs/sidebar collapse before they ship, or the "single shared token" premise epics.md asserts is false in practice. Flag this for reconciliation (queue a memlog entry / architecture note) before those stories are contexted — do not silently resolve it differently in each one.

### FE state substrate (AD-17, NFR-5) — established here for the first time

No frontend code exists yet anywhere in the repo. This story is where the whole client-state architecture gets stood up, and every later UI story (3.2, 3.3, 4.3, 5.1) inherits it verbatim — get the shape right:

- **Server state**: TanStack Query v5 only. Query-keys factory in `apps/web/lib/queries.ts` — every later story's hooks extend this one factory, never invent a parallel one.
- **Client state**: React Context for exactly two things — UUID identity and theme (per NFR-5, do not add a third Context for form state; that's local `useState`/`useReducer` in `session-form.tsx`). `useLocalStorage` for persisted prefs.
- **No Zustand, no Redux.**
- **UUID before hydration**: the inline `<head>` script is load-bearing — any surface that reads identity before this runs risks a hydration mismatch. `UserProvider` must not attempt to generate its own UUID as a fallback in a `useEffect` (that reintroduces the race this pattern exists to avoid).
- **`api.ts` is the single fetch surface.** Every later story's API calls should go through it (or through `queries.ts` hooks built on it), not through ad hoc `fetch()` calls, so `X-User-Id` injection and error-envelope parsing stay centralized.

### Design tokens (`DESIGN.md`) — implement these exactly

Tailwind 4.3.3 is CSS-first (`@theme` in `globals.css`, not `tailwind.config.js`). All values below are contrast-verified in DESIGN.md — do not substitute similar-looking colors.

**Colors** (light / dark pairs):

| Token                | Light     | Dark      |
| -------------------- | --------- | --------- |
| `surface-base`       | `#FAF8F5` | `#1A1815` |
| `surface-raised`     | `#FFFFFF` | `#232019` |
| `surface-sunken`     | `#F1EDE7` | `#141210` |
| `ink`                | `#2A2723` | `#EDE9E2` |
| `ink-muted`          | `#6B655D` | `#A39C91` |
| `primary`            | `#3F6B7D` | `#8FB8CC` |
| `primary-foreground` | `#FFFFFF` | `#1A1815` |
| `accent`             | `#A85A2B` | `#E29B6B` |
| `accent-foreground`  | `#FFFFFF` | `#1A1815` |

Landing doesn't render strength chips (`strength-strong/mixed/weak`) — wire those tokens too since `@theme` is global, but they have no consumer in this story.

**Typography** (this story mainly uses `display` for the page heading and default shadcn body/label for the form): `display` = Geist Sans 30px/600/1.2/-0.01em. `reading` (17px/1.65, capped at `reading-measure` 68ch) is used for narration/error copy if it runs long.

**Shapes/spacing**: `rounded.md` (10px) for inputs/buttons/cards; `rounded.full` reserved for the (currently unused-by-this-story) strength chips and progress indicator — do **not** invent a determinate progress bar with it (AC #8 forbids one). `card-padding` 24px, `option-gap` 12px if the strategy picker uses option-card styling.

**Focus ring**: 2px `accent`, 2px offset, non-negotiable on every interactive element (AC #14).

**Never**: introduce red (no `destructive` styling anywhere on this page — there is nothing destructive on landing); a determinate progress bar; a second accent color; color as the sole carrier of meaning.

**Motion**: import from `motion/react` (renamed from `framer-motion` Nov 2024) — `12.42.2`. Page fade+slide on route change is the only motion this story needs; nothing celebrates, nothing loops.

### Landing form behavior (`EXPERIENCE.md`)

- **Strategy picker has no default, ever.** This is a stated **security property** (free-text strategy would be a prompt-injection vector; the enum-only constraint is the mitigation, and a UI that "helpfully" pre-selects one undermines the deliberate-choice requirement FR-2 relies on). Model the initial state as genuinely absent, not "first option selected."
- **Provider → model is dependent.** Changing provider resets model to that provider's default (`minimax` → `MiniMax-M3` when present).
- **`questionCount` default is 8**, not empty — this is the one field allowed a pre-filled value.
- **Topic hint is optional, ≤200 chars, never treated as an instruction.** It's in `EXPERIENCE.md`'s field list even though epics.md's literal AC text for 2.7 doesn't spell it out separately (it's covered by "the full request contract" in AC #7); include it as specified in `EXPERIENCE.md`/PRD since it's a real, documented request field with no reason to withhold it from the form.
- **Entire option row is the hit target** for the strategy picker, consistent with the answer-option pattern used elsewhere in the product (44px+ touch targets throughout).

### The long wait — narration (`EXPERIENCE.md`, exact copy)

| Elapsed | Copy                                                        |
| ------- | ----------------------------------------------------------- |
| 0s      | Fetching the document…                                      |
| ~3s     | Reading it through…                                         |
| ~8s     | Writing your questions…                                     |
| ~20s    | Almost there — longer documents take a little more thought. |

Rules: **stages only advance forward**, never loop or reset — a looping animation reads as hung. The final stage is honest about the overrun rather than pretending. **No determinate progress bar** — the system cannot know real progress, and a bar stalled at 90% costs more trust than an honest indeterminate wait. This is purely client-side and time-driven; it makes no server round trip and reports no real progress (the single `POST /api/sessions` call is what's actually in flight). Build `NarratedWait` generically (stage list + timings as props) — Story 3.1's submit narration (`Scoring your answers…` → `Working out where the gaps are…`) reuses the same component with different copy.

### Error copy (subset relevant to this story)

All failures return `{error:{code,message,requestId}}` (Story 1.5's envelope) with no stack trace. Show human copy, never the raw code; `requestId` is available but de-emphasized.

| Code / condition                                                       | Copy                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DOC_TOO_LARGE` (size)                                                 | This document is too large to process. Try a more focused page.                                                    |
| `DOC_TOO_LARGE` (context)                                              | This document is longer than the selected model can read. Switch provider or model — MiniMax-M3 handles 1M tokens. |
| `DOC_TOO_SHORT`                                                        | This document is short — there's enough here for about {n} questions. Reduce the question count to continue.       |
| SSRF blocked                                                           | That URL can't be fetched — it points to a private or restricted address.                                          |
| 400 invalid URL                                                        | That doesn't look like a public document URL. It should start with `http://` or `https://`.                        |
| 429                                                                    | You're going a bit fast. Try again in {Retry-After} seconds.                                                       |
| Generation failed (generic 5xx / `UntrustedLlmOutputError` → `failed`) | We couldn't build a quiz from this document. **[Retry]**                                                           |

Hints name the field to change and, where possible, focus it (e.g. `DOC_TOO_SHORT` should focus the `questionCount` control). 404/409 are not reachable from this page — leave `error-copy.ts` extensible for the stories that need them, but do not implement entries this story can't produce.

### API contract this story consumes

`POST /api/sessions` (built across Stories 2.1–2.6):

```json
{
  "sourceUrl": "https://raw.githubusercontent.com/.../README.md",
  "topic": "optional hint, ≤200 chars",
  "strategy": "mixed",
  "questionCount": 8,
  "provider": "minimax",
  "model": "minimax/MiniMax-M3"
}
```

Header: `X-User-Id: <uuid-v4>`. Response on success carries the session id and `status`. This is a **synchronous** call (5–30s typical) — there is no polling in v1 ([A-8]); the response itself is `ready` or `failed`.

`GET /api/config/providers` (Story 2.3) → `{minimax: [...models], openrouter: [...free models]}` when both keys are set, `{minimax: [...]}` when only one, `{}`/`[]` when neither (default-deny). If the OpenRouter live-catalog fetch fails server-side, the endpoint degrades to MiniMax-only rather than 5xx — the FE just renders whatever it gets, no special-case handling needed here.

### Previous story context (Epic 1, all `ready-for-dev`, no code exists yet)

- **Story 1.1** built the `apps/web` package.json/tsconfig **stub only** — no Next.js app code. This story is the first to add real content there. Its scope-boundary table is the source of the `@ai-quiz/require-data-testid` → Story 5.2 resolution above.
- **Story 1.4** built server-side `X-User-Id` validation (UUID v4 format, 400 on malformed) and the ownership chain. This story is the first **client** to actually send that header — no server-side changes needed, just make sure the browser-generated UUID is a valid v4 (`crypto.randomUUID()` always produces v4, so this is automatic).
- **Story 1.5** built CORS (exact `WEB_ORIGIN` + dev-only regex), helmet, rate limiting, and the `{error:{code,message,requestId}}` `SafeExceptionFilter` shape. This story's `api.ts` must parse that exact shape; do not assume a different error body format.
- None of 1.1–1.6 have been implemented yet (repo has no `apps/` source code), so there is no git history or file-list intelligence to inherit beyond what's written into each story file.

### Testing standards summary

- **Vitest** component tests for this story's client logic (Task 9) — first use of component-testing tooling in the repo; add it under `apps/web`'s Vitest project, extending Story 1.1's root `test.projects` config, not a new runner.
- **No Playwright work in this story** — `apps/web/e2e/` and `landing.spec.ts` are Story 5.2.
- `pnpm --filter @ai-quiz/web test` must be green before marking done; `pnpm verify` remains the overall gate (`lint:check && typecheck && test && test:e2e && build` — `test:e2e` stays a no-op until Story 5.2 installs Playwright, per Story 1.1's Task 5 note).

### Project Structure Notes

New files (first real content under `apps/web`, which currently has only the Story-1.1 stub):

```
apps/web/
  next.config.ts                          NEW
  app/
    layout.tsx                            NEW — <head> UUID script, Providers wrapper
    providers.tsx                         NEW — QueryClientProvider + UserProvider + ThemeProvider
    page.tsx                              NEW — landing composition
    globals.css                           NEW — @theme design tokens
  components/
    states/
      narrated-wait.tsx                   NEW — generic, reused by Story 3.1
      error-state.tsx                     NEW — generic
      rate-limited-state.tsx              NEW — generic
      empty-state.tsx                     NEW — generic, reused by Story 5.1
    landing/
      session-form.tsx                    NEW
      strategy-picker.tsx                 NEW
      provider-model-select.tsx           NEW
      question-count-select.tsx           NEW
    ui/                                   NEW — shadcn-generated primitives (Button, Input, Select, RadioGroup, Skeleton, Card)
  lib/
    api.ts                                NEW
    queries.ts                            NEW
    user-context.tsx                      NEW
    theme-context.tsx                     NEW
    use-local-storage.ts                  NEW
    error-copy.ts                         NEW
apps/web/package.json                     UPDATE (Story 1.1 stub)
apps/web/tsconfig.json                    UPDATE (Story 1.1 stub — verify it still extends tsconfig.base.json)
```

Do **not** create `apps/web/app/quiz/`, `apps/web/app/result/`, `apps/web/components/history/`, or `apps/web/lib/sanitize.ts` in this story — see Scope Boundary.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.7: Landing page & quiz start flow] — the binding ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2: Generate a grounded quiz from any URL] — epic boundary note (generation ends at `status='ready'`; `/quiz/[id]` is Story 3.3)
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements → Shared UI conventions] — `md` breakpoint token, `data-testid` lint rule, `components/states/` convention
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-5, #FR-14, #NFR-5 · 10.5, #NFR-2 · 10.2] — quiz-start UI, provider endpoint, FE state, rate limits
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-17 — FE state split] — TanStack Query + Context, no Zustand/Redux, UUID-before-hydration
- [Source: .../ARCHITECTURE-SPINE.md#AD-6 — Provider-agnostic via Mastra] — `GET /api/config/providers` default-deny shape
- [Source: .../ARCHITECTURE-SPINE.md#AD-N7, AD-N8] — rate limits + `Retry-After`, CORS
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.6 REST API, #A.10 Environment, #A.11 UI, #A.4 Repo Layout] — request/response shapes, `NEXT_PUBLIC_API_URL`, page inventory, `lib/` file list
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/DESIGN.md] — colors, typography, spacing, rounded, focus ring, motion stack (`motion/react` not `framer-motion`), Tailwind 4 `@theme` note
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/EXPERIENCE.md#Foundation, #Information Architecture, #Voice and Tone, #Component Patterns, #State Patterns, #Interaction Primitives, #Accessibility Floor, #Responsive & Platform] — form field list, narration copy/timing, error copy table, a11y floor, breakpoint table (flagged conflict above)
- [Source: _bmad-output/project-context.md#Frontend state, #Tooling Rules] — state substrate rules, custom-ESLint-rule sequencing
- [Source: _bmad-output/implementation-artifacts/1-1-monorepo-scaffold-and-tooling-gate.md#Scope Boundary] — `@ai-quiz/require-data-testid` → Epic 3+/Story 5.2; `apps/web` stub contents
- [Source: _bmad-output/implementation-artifacts/1-4-per-session-ownership-walking-skeleton-sessions-endpoint.md] — `X-User-Id` v4 contract this page's UUID must satisfy
- [Source: _bmad-output/implementation-artifacts/1-5-network-hardening-rate-limiting-cors-helmet-error-shape.md] — `{error:{code,message,requestId}}` envelope, CORS/`WEB_ORIGIN`, 429 + `Retry-After`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
