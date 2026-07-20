# Story 5.1: Session history & revisit

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a returning user,
I want to see my past sessions and reopen one,
so that I can review what I got wrong later, from the same browser.

> **Naming note (read before anything else):** epics.md titles this story "Revisit history … on any device." That phrase is about **responsive layout across device form factors** (phone/tablet/desktop), **not** cross-device data sync. See Dev Notes → "What 'any device' actually means" — this is load-bearing for scope and must not be misread as a request to build device-to-device history transfer.

## Acceptance Criteria

_(UJ-3, FR-8 consumed, AD-17; UX: DESIGN.md, EXPERIENCE.md; epics.md Story 5.1 + Shared UI conventions, corrected 2026-07-20)_

1. **`GET /api/sessions` is scoped and ordered.** Given an authenticated request, then it returns only the caller's sessions (filtered by the internal `users.id` resolved by `identity.interceptor.ts`, per Story 1.4's identity translation — never the raw `X-User-Id`), newest first, using the **existing** `idx_quiz_sessions_user_id_created_at` index (Story 1.3 AC #10) — **no new index or migration is added by this story**. Another user's sessions never appear, in any page.
2. **History sidebar lists prior sessions.** Given `/` (landing — the **only** route this sidebar appears on, per EXPERIENCE.md's Information Architecture table and Story 3.2's explicit confirmation that `/result/[id]` has none), then it lists prior sessions with source URL, status, and created date, and every interactive element carries `data-testid`.
3. **`lg` is the only structural breakpoint for the sidebar/sheet collapse — epics.md's literal `md` text here is stale.** Given a viewport `≥ 1024px` (Tailwind's built-in `lg` token), then the sidebar renders as a **persistent panel** beside the landing form (DESIGN.md's "two-pane" layout); given a viewport `< 1024px`, then it collapses to a **slide-out sheet** triggered by a visible control. See Dev Notes → "Breakpoint resolution" for why the epics.md AC text (768px) is not followed.
4. **Submitted session → results.** Given a `submitted` session's row is clicked, then the app navigates to `/result/[id]`, where the results, insights, and chat thread load exactly as previously seen (Story 3.2/4.3's existing fetch-on-mount behavior — no new backend work needed; see Dev Notes).
5. **`pending` or `ready` session → resume the quiz.** Given a `pending` or `ready` session's row is clicked, then the app navigates to `/quiz/[id]`, which resumes it with status preserved server-side (Story 3.3 already renders the correct per-status UI, **including** the `pending` generation-in-progress state it built anticipating exactly this flow — see Dev Notes → "Reconciling Story 3.3's `pending`-state gap").
6. **`failed` session → inline error, not navigation.** Given a `failed` session's row, then it does **not** navigate on click; it shows an error indicator (icon + text, never a bare red/`destructive` treatment — DESIGN.md's no-red rule) and a **retry affordance** that starts a fresh session **from the same URL** by prefilling the landing form's URL field and focusing it — it does not blindly re-`POST /sessions` (see Dev Notes → "Retry does not auto-resubmit").
7. **Ownership regression holds for both the item and the list route.** Given `GET /api/sessions/:id` for another user's session, then it returns 404 (already enforced by Story 1.4 — this story adds a regression test, not new server logic). Given `GET /api/sessions` (the list, no `:id`), then it is inherently scoped by the internal `users.id` filter and never requires a separate `@OwnsSession()` check (that decorator exists for `:id`-scoped routes only).
8. **Empty state.** Given a first-time user with zero sessions, then the sidebar shows the shared `EmptyState` component (Story 2.7 built this generic and explicitly reserved it for this story's reuse) with copy stating plainly that history is bound to this browser (EXPERIENCE.md's Trust & Disclosure copy, verbatim — see Dev Notes) — never a blank or broken panel.
9. **Bounded, paginated list.** Given a user with a large session history, then `GET /api/sessions` returns a capped page (default 20, max 50) with a **load-more** affordance in the UI, never an unbounded result set. See Dev Notes → "Pagination contract" for the exact cursor shape.
10. **`data-testid` coverage (attributes only).** Given every interactive element this story adds (sheet trigger, each session row, retry buttons, load-more button, empty-state elements), then it carries `data-testid`; tests use `getByTestId(...)` only. The **enforcing** ESLint rule `@ai-quiz/require-data-testid` is **not** built in this story — Story 5.2's, per the Story 1.1/2.7/3.2/3.3 precedent.
11. **Single mount — no duplicate `data-testid`s across the desktop/mobile split.** Given the sidebar's session-list content, then it never renders in two DOM locations simultaneously (desktop static panel + open mobile sheet) — see Dev Notes → "Avoiding duplicate mounts" for the exact technique, which differs from Story 3.2's Tabs pattern for a stated reason.
12. **Accessibility.** Given the sheet (`< lg`), then it is dismissible by swipe and by `Escape` (Radix `Dialog`/`Sheet` defaults — do not override), focus is trapped while open and returns to the trigger on close; given any focusable element added by this story, then it carries the visible 2px `{colors.accent}` focus ring (2px offset).
13. **Voice, tone, and error copy.** Given any copy this story introduces (empty state, failed-row error text, retry label), then it follows EXPERIENCE.md's Voice and Tone rules — second person, present tense, no exclamation marks, no emoji, no gamification, names the remedy rather than the blame.
14. **Tests.** Given the list endpoint's scoping/pagination/ordering and the sidebar's rendering/routing/retry logic, then Vitest (API integration + FE component) tests cover it. Full Playwright E2E (mobile viewport project, sidebar → slide-out assertions) is **not** built in this story — Story 5.2's, per Dev Notes → Scope Boundary.

## Tasks / Subtasks

- [ ] **Task 1 — Shared Zod schemas** (AC: #1, #7, #9)
  - [ ] In `packages/shared/src/schemas.ts` (UPDATE — read the whole file first; Stories 1.3/1.4/2.6/3.1/4.1 have all extended it), add:
    - `SessionSummarySchema` (wire, `.strict()`): `{ id: z.string().uuid(), sourceUrl: z.string().url(), status: z.enum(['pending','ready','submitted','failed']), createdAt: z.date() }` — **deliberately minimal**, matching the literal epics.md AC ("source URL, status, and created date"). Do not add `finalScore`, `topic`, `strategy`, or other fields no AC asks for.
    - `ListSessionsQuerySchema` (inbound wire, `.strict()`): `{ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().datetime().optional() }`. `before` is the `createdAt` of the last row from the previous page (exclusive cursor) — same idiom as Story 4.1's `findRecentForUser(sessionId, userId, before?: Date)` for chat, not a new pagination style.
    - `SessionsListResponseSchema` (outbound wire, `.strict()`): `{ sessions: z.array(SessionSummarySchema), hasMore: z.boolean() }` — mirrors Story 4.1's `ChatHistoryResponseSchema` shape (`{messages, hasMore}`) intentionally, for consistency across the two "recent items + load more" surfaces in this app.
  - [ ] Do **not** reuse `QuizSessionRowSchema` (Story 1.3/1.4/2.6) as the wire shape — AD-3's "row ≠ wire" split applies here exactly as it did for `QuizQuestionResponseSchema` vs `QuestionRowSchema` in Story 2.6.

- [ ] **Task 2 — Repository method (canonical adapter pattern)** (AC: #1, #7, #9)
  - [ ] Extend `QuizRepositoryPort` (`apps/api/src/domain/ports/quiz-repository.port.ts`, UPDATE — Story 1.4's file) with `listForUser(userId: string, params: { limit: number; before?: Date }): Promise<{ rows: readonly QuizSessionRowDto[]; hasMore: boolean }>`. Naming follows the `forUser*`/scoped convention the `@ai-quiz/no-unscoped-session-query` lint rule (Story 1.4) expects — though note this method queries `quiz_sessions.user_id` directly (the root owned table, no `session_id` join), which is the same shape as Story 1.4's own `findByIdAndUserId`, not the child-table pattern the lint rule targets.
  - [ ] Implement in `apps/api/src/adapters/persistence/drizzle/quiz-session.repository.ts` (UPDATE — Story 1.4's file). Query: `WHERE user_id = $1 [AND created_at < $2] ORDER BY created_at DESC, id DESC LIMIT $3+1`. Fetch `limit + 1` rows; if the result has more than `limit`, set `hasMore = true` and return only the first `limit`; otherwise `hasMore = false`. This is the architecture-spec.md §A.3 `listByUserId` sketch, adapted with a cursor (that sketch used a flat `limit=50`, no cursor — this story is the first to need real "load more" pagination).
  - [ ] Design ruling — no composite `(created_at, id)` predicate in the `WHERE` clause, only `created_at < $2`: two sessions sharing the exact same microsecond `created_at` are effectively impossible in this app's interactively-created-one-at-a-time usage pattern, so the theoretical skip-a-row risk from cursoring on `created_at` alone is accepted — this mirrors the same precision Story 4.1's chat pagination already accepts for its own `before: Date` cursor. `id DESC` is still included in `ORDER BY` as a deterministic tie-break for stable results within a page, at no index cost (it doesn't need to be a WHERE predicate).
  - [ ] Every returned row is `Object.freeze(QuizSessionRowSchema.parse(row))` (AD-3) — the repository returns **row** DTOs; the controller (Task 4) projects down to `SessionSummarySchema` for the wire. Do not have the repository build the wire shape directly — that would collapse the row/wire split the rest of the schema file already establishes.
  - [ ] Bind to the ALS `tx` from `identity.interceptor.ts` — never a fresh pool connection (Story 1.4's pattern, repeated in every story since).

- [ ] **Task 3 — Controller: `GET /api/sessions`** (AC: #1, #7, #9)
  - [ ] `apps/api/src/driving/sessions/sessions.controller.ts` (UPDATE — Story 1.4/2.6/3.1's file; read fully first). Add `@Get()` (list) alongside the existing `@Get(':id')` (detail) — these are structurally different paths (`/sessions` vs `/sessions/:id`), so there is no NestJS route-ordering conflict to worry about.
  - [ ] `ZodValidationPipe(ListSessionsQuerySchema)` on the query string. Read `userId` from the ALS request context (`getRequestContext()`, Story 1.4) — the **internal** `users.id`, same source every other authenticated route already uses. **No `@OwnsSession()`** on this route (AC #7) — that decorator is for `:id`-scoped ownership checks; the list route is inherently scoped by the `WHERE user_id = ?` filter in Task 2.
  - [ ] Map each returned row to `SessionSummarySchema` (`{id, sourceUrl, status, createdAt}`), return `SessionsListResponseSchema`-shaped body with **200**.
  - [ ] No new rate-limit tier — `GET /api/sessions` is not one of AD-N7's named routes (Global / `POST /sessions` / `POST /chat`), so it inherits the Global 30/min (per-user + per-IP) limit, same reasoning Story 3.1 applied to `POST /submit`.
  - [ ] Add the ownership regression test: user A has sessions; user B's `GET /api/sessions` never includes any of A's rows (list-scoping test, distinct from the existing `:id` 404 test).

- [ ] **Task 4 — Query-keys factory + infinite query hook** (AC: #9)
  - [ ] `apps/web/lib/queries.ts` (UPDATE — Story 2.7's factory, already extended by Stories 3.2/3.3; read fully first, extend, never fork). Add `queryKeys.sessions.list()` and `useSessionsInfiniteQuery()` using TanStack Query v5's `useInfiniteQuery`: `initialPageParam: undefined`, `getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.sessions.at(-1)?.createdAt : undefined`, calling `GET /api/sessions` through the existing `lib/api.ts` wrapper (no ad hoc `fetch()`).
  - [ ] In `useCreateSessionMutation`'s `onSuccess` (Story 2.7's hook, UPDATE), add `queryClient.invalidateQueries({ queryKey: queryKeys.sessions.list() })` — Story 2.7 predates the sessions-list query key, so it can't have wired this itself. Without it, a freshly created session would not appear in the sidebar on a later visit to `/` until some other cache invalidation happened to occur.

- [ ] **Task 5 — History list + row components** (AC: #2, #6, #8, #10, #13)
  - [ ] `apps/web/components/history/history-list.tsx` — renders the flattened pages from `useSessionsInfiniteQuery()`: loading → skeleton rows (`history-row-skeleton.tsx`, shadcn `Skeleton`); empty (zero sessions across all pages, not loading) → reuse `EmptyState` (Story 2.7) with the Trust & Disclosure copy (Dev Notes → exact string); populated → one `HistoryRow` per session + a "load more" button (visible only when `hasMore`, calls `fetchNextPage()`, disabled while `isFetchingNextPage`).
  - [ ] `apps/web/components/history/history-row.tsx` — renders source URL, a plain status indicator (**not** `{components.strength-chip}` — that token is reserved for category strong/mixed/weak semantics, a different meaning; a session's lifecycle status needs its own simple text/icon treatment, never `destructive`/red styling even for `failed`, per DESIGN.md's no-red rule), and created date. Below `md` (768px — **non-structural**, per epics.md's Shared UI conventions: "landing form and history list stacking only"), the row's fields stack vertically instead of inline; this is independent of the `lg` sidebar/sheet decision in AC #3.
    - `submitted` row: whole row is a button/link; click → `router.push('/result/' + id)`.
    - `pending`/`ready` row: whole row is a button/link; click → `router.push('/quiz/' + id)`.
    - `failed` row: **not** a navigation control. Renders an icon + text error indicator and a separate `data-testid="history-row-retry-{id}"` button. Click → calls the `onRetry(sourceUrl)` callback from Task 6 (prefill, not re-POST).
  - [ ] `data-testid="history-row-{id}"` on each row's outer element; `data-testid="history-load-more"` on the load-more button.

- [ ] **Task 6 — Retry wiring (prefill, not auto-resubmit)** (AC: #6, #13)
  - [ ] `apps/web/app/page.tsx` (UPDATE — Story 2.7's file) becomes the shared-state owner: add a small piece of client state (`prefillUrl: string | undefined`) passed down to both `SessionForm` (as a controlled/initial value for the URL field) and `HistorySidebar` (as the `onRetry` callback target). This does **not** violate AD-17/NFR-5's "exactly two Contexts" rule — it's local `useState` in a client wrapper component, the same category of state Story 2.7's own Dev Notes reserved for `session-form.tsx` (not a new Context).
  - [ ] `apps/web/components/landing/session-form.tsx` (UPDATE — Story 2.7's file; read fully first) accepts an optional prop to seed/override its URL field value and to focus it when it changes.
  - [ ] Clicking a failed row's retry button: (1) sets `prefillUrl` to that row's `sourceUrl`, (2) closes the mobile sheet if it is open (Task 7), (3) focuses the URL input. The user still clicks **Start** themselves — this story does not auto-`POST /sessions`. Rationale: the session summary payload (AC intentionally minimal, Task 1) doesn't carry `strategy`/`provider`/`model`/`questionCount`, so there's nothing to resubmit blindly with; more importantly, an automatic re-POST on page load would silently consume `POST /sessions`'s 5/min budget (NFR-2) without the user having decided to retry yet, and — per EXPERIENCE.md's "no fabricated confidence" principle — a failure that already happened once shouldn't be retried without the user seeing and confirming the same inputs.

- [ ] **Task 7 — Responsive shell: persistent panel (`≥lg`) vs. slide-out sheet (`<lg`)** (AC: #3, #11, #12)
  - [ ] Add `apps/web/components/ui/sheet.tsx` (shadcn `Sheet` — first consumer in this repo; DESIGN.md lists `Sheet` among the components that "ship from shadcn... inherit as-is").
  - [ ] `apps/web/components/history/history-sidebar.tsx` — owns the `mobileOpen` boolean (`useState`, default `false`) and renders **two JSX locations** for the sidebar chrome (a static `<aside>` and a `<Sheet>`), but gates them so `HistoryList` is only ever mounted in **one** of the two at a time:
    ```tsx
    <aside className="hidden lg:block" data-testid="history-sidebar-panel">
      {!mobileOpen && <HistoryList {...} />}
    </aside>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetTrigger asChild>
        <Button className="lg:hidden" data-testid="history-sheet-trigger">History</Button>
      </SheetTrigger>
      <SheetContent side="right" data-testid="history-sidebar-sheet">
        <HistoryList {...} />
      </SheetContent>
    </Sheet>
    ```
    See Dev Notes → "Avoiding duplicate mounts" for why this (state-gated, not CSS-only) technique is used here instead of Story 3.2's `forceMount` + CSS-visibility trick, and why it is still hydration-safe (no viewport-detection JS).
  - [ ] `≥lg` (trigger is `lg:hidden`, unreachable): `mobileOpen` can never become `true`, so the aside always renders `HistoryList`; the Sheet is never opened, so its content never mounts. Exactly one live copy.
  - [ ] `<lg`: aside is CSS-hidden but present (Tailwind `hidden`) and additionally gated by `!mobileOpen`; when the user opens the sheet, the aside's `HistoryList` unmounts and the sheet's copy is the only one in the DOM. Exactly one live copy at every moment.
  - [ ] Consume Tailwind's built-in `lg` token only — no `md:` classes on this shell, no arbitrary variants, no `matchMedia`/viewport-detection hook anywhere in this component (matches the "no JS breakpoint hook" convention Story 3.2 established for its own responsive shell).
  - [ ] `apps/web/app/page.tsx` (UPDATE, continued from Task 6): compose the `≥lg` two-pane grid (`DESIGN.md`: "Landing two-pane: form + history sidebar") with `SessionForm` and `HistorySidebar` as siblings; at `<lg` the form is full-width and `HistorySidebar`'s trigger renders inline (its own component handles its internal responsive behavior per Task 7).

- [ ] **Task 8 — Empty-state copy** (AC: #8, #13)
  - [ ] Use `EmptyState` (Story 2.7) with EXPERIENCE.md's exact Trust & Disclosure copy: _"Sessions are saved to this browser. There's no account to sign in to."_ Stated once, plainly, not as a warning (EXPERIENCE.md's own framing) — do not editorialize or soften/dramatize it further.

- [ ] **Task 9 — Accessibility pass** (AC: #12)
  - [ ] Verify Radix `Sheet`/`Dialog` defaults are intact: `Escape` closes, swipe-to-dismiss (touch), focus trapped while open, focus returns to the trigger on close. Do not override any of these.
  - [ ] Focus ring token (`{colors.accent}`, 2px, 2px offset — already global via Story 2.7's `@theme` wiring) on the sheet trigger, every row (as an interactive element), retry buttons, and the load-more button.

- [ ] **Task 10 — Tests** (AC: #14)
  - [ ] `apps/api/test/integration/sessions-list.integration.test.ts` — real Postgres: ordering (newest first), pagination (`limit`/`before`/`hasMore` correctness across 3+ pages), user-scoping (user B never sees user A's rows).
  - [ ] `apps/api/test/security/ownership-list.security.test.ts` — the list-scoping regression named in AC #7 (distinct from Story 1.4's existing `:id` 404 test, which already covers the single-item case and needs no new work here beyond confirming it still passes).
  - [ ] Vitest component tests (`apps/web`, Story 2.7's project — extend, don't fork): `HistoryList` renders skeleton/empty/populated states correctly; `HistoryRow` routes by status (submitted → `/result/`, pending/ready → `/quiz/`, failed → no navigation + retry callback fires with the right `sourceUrl`); `HistorySidebar` never renders `HistoryList` twice simultaneously when `mobileOpen` toggles (a direct test of the Task 7 design ruling — assert exactly one element matches a given row's `data-testid` at any point in the toggle sequence); load-more triggers `fetchNextPage` and is hidden when `hasMore` is false; retry prefills and focuses the URL field in `SessionForm`.
  - [ ] Full Playwright `full-quiz.spec.ts`/history assertions and the mobile-viewport project are **out of scope** — Story 5.2.
  - [ ] Run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test && pnpm --filter @ai-quiz/web test` before marking done.

## Dev Notes

### 🚨 Scope boundary — read first

| Belongs to           | NOT this story                                                                                                                                                                     | Why                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Story 5.2**        | `apps/web/e2e/`, `full-quiz.spec.ts`/history assertions, the Playwright mobile-viewport project, the **enforcing** `@ai-quiz/require-data-testid` lint rule                        | This story hand-applies `data-testid` (AC #10) and adds Vitest tests only (Task 10), per the Story 1.1/2.7/3.2/3.3 precedent.                                                                                                                      |
| **Story 5.3**        | Cross-user isolation E2E (`security.spec.ts`), the full RLS-verification sweep across all 8 owned tables                                                                           | This story adds one API-layer list-scoping regression test (Task 10); the epic-wide security sweep is 5.3's deliverable.                                                                                                                           |
| **Story 3.2**        | `/result/[id]` page content, dual-panel/tabs shell, results panel, chat slot                                                                                                       | This story only navigates there on a `submitted` row click (AC #4) — it does not render or modify anything on that route. Confirmed by Story 3.2's own Dev Notes: the history sidebar is explicitly **not** on `/result/[id]`.                     |
| **Story 3.3**        | `/quiz/[id]` page content, including the `pending`-state UI this story's resume flow lands on                                                                                      | This story only navigates there on a `pending`/`ready` row click (AC #5). Story 3.3 built `quiz-pending-state.tsx` **anticipating** this exact flow — see "Reconciling Story 3.3's `pending`-state gap" below. Do not rebuild that state here.     |
| **Story 4.3**        | Chat panel rendering, "view older", thread restoration on revisit                                                                                                                  | Already wired to fetch on mount regardless of how `/result/[id]` was reached (fresh submit vs. history revisit) — no new work needed here for "chat thread loads as previously seen" (AC #4).                                                      |
| **Story 2.7 (done)** | `lib/api.ts`, the query-keys factory shape, `UserProvider`/UUID-before-hydration, `components/states/{EmptyState,ErrorState,...}`, `@theme` tokens, `session-form.tsx`'s field set | This story **extends** `page.tsx`, `session-form.tsx`, and `lib/queries.ts` (UPDATE, not fork) and reuses `EmptyState` — which Story 2.7's own Dev Notes explicitly reserved for this story ("Story 5.1 reuses it for the empty history sidebar"). |
| **Story 1.4 (done)** | `X-User-Id`/identity translation, `@OwnsSession()`, the RLS migration + `quiz_sessions` policy, `idx_quiz_sessions_user_id_created_at`                                             | Already built. This story is the **first consumer** of the index for its intended purpose (the index was added in Story 1.3 specifically anticipating this story — 1.3's AC #10 says so verbatim). No new migration, no new policy.                |
| **Epic 4**           | Chat backend/UI                                                                                                                                                                    | Not touched.                                                                                                                                                                                                                                       |

### What "any device" actually means — read before designing anything

There is **no auth and no cross-device sync** in this product (PRD §5 Non-Goals; project-context.md "Identity: `X-User-Id` only"). Identity is a `crypto.randomUUID()` generated once per browser in `localStorage` (Story 2.7, `AD-17`). `GET /api/sessions` is scoped to that UUID's resolved `users.id` — there is no mechanism, in this story or anywhere else in the spec, to see a session created under a **different** browser/localStorage profile. EXPERIENCE.md's own Trust & Disclosure section says this outright: _"History is bound to this browser via a locally stored ID... Sessions are saved to this browser. There's no account to sign in to."_

So epics.md's story title ("Revisit history on any device") and PRD UJ-3 ("Sam comes back a week later, on their phone") are about **responsive layout working correctly on any device form factor** (the sidebar collapsing to a usable slide-out on a phone, per AC #3), not about transferring history between two different physical devices. **Do not build anything — a QR code, a "copy this link" share, a manual UUID-entry field — to bridge two browsers.** None is specified, and inventing one here would be unrequested scope: the honest, spec-accurate behavior is that Sam's phone only shows history created _from that phone's browser_. If a future story wants real cross-device history, it needs an actual identity system (real auth), which is explicitly out of scope for v1 (PRD §5).

### Breakpoint resolution — follow `lg`, epics.md's literal AC text here is stale

Same situation Story 3.2 already resolved for the result-page shell, now applied to the sidebar:

- **epics.md's literal Story 5.1 AC text** (not yet re-synced after the correction) says: _"Given a viewport narrower than the shared `md` breakpoint (768 px), Then the sidebar collapses to a slide-out."_ This predates the `lg`-breakpoint correction.
- **`ARCHITECTURE-SPINE.md` AD-21** (amended 2026-07-20, `[AMENDED 2026-07-20 — lg supersedes md]`) is explicit and **names this exact story**: _"Binds: `apps/web` layouts; Stories 2.7, 3.2, 3.3, 4.3, 5.1... Collapse at Tailwind's built-in `lg` token... the history sidebar → slide-out sheet. Both must use this one boundary."_
- **`DESIGN.md`/`EXPERIENCE.md`** (both `status: final`) confirm: `History sidebar (lg+) / slide-out sheet (< lg)` and the breakpoint table's `≥1024px` row lists "History as persistent sidebar."
- **epics.md's own "Shared UI conventions" section** (the non-story-specific part, already corrected) states `lg` = 1024px is the structural boundary and `md` = 768px is reserved for "landing form and history list stacking only" — non-structural.

**This story's binding rule:** `lg` = 1024px governs the sidebar-vs-sheet structural collapse (AC #3). `md` = 768px governs only the internal stacking of a history row's fields (URL/status/date) and the landing form — neither is the sidebar/sheet decision. If a future artifact still says `md` = 768px is structural for the sidebar, it is the same stale residue flagged here and in Story 3.2 — do not follow it.

### Reconciling Story 3.3's `pending`-state gap

Story 3.3 (quiz-taking UI) flagged that `EXPERIENCE.md`'s per-surface state list for `/quiz/[id]` has no `pending` state, even though its own binding AC requires one, and resolved it by building `quiz-pending-state.tsx` — "a static message... with a manual refresh action... and a link to `/`" — explicitly because "Story 5.1 routes `pending` sessions here, so this is reachable." **This story is the thing Story 3.3 was anticipating.** AC #5 above is satisfied purely by navigation (`router.push('/quiz/' + id)`); the receiving UI is entirely Story 3.3's, already built for this. Do not add a second "generation in progress" treatment here, and do not add polling — `[A-8]`'s no-polling decision holds; a user who resumes a `pending` session sees Story 3.3's static message and manual-refresh link, not a live progress indicator (there is no server-side signal to back one, since v1 never uses the reserved async-polling escape hatch).

### `ready`, not just `pending`, resumes at `/quiz/[id]`

`ready` sessions are fully generated but never submitted — a user may have started answering and closed the tab. Story 3.3's `ready` branch is its primary rendering path (question 1 of N, answer state starts empty since v1 has no server-side draft-answer persistence — this story doesn't add any). Clicking a `ready` history row simply re-opens the quiz from the top; this is existing, unmodified Story 3.3 behavior.

### Avoiding duplicate mounts — why this story doesn't reuse Story 3.2's exact technique

Story 3.2 solved "dual-panel vs. tabs" by mounting `ResultsPanel` and `ChatPanelSlot` **once each**, inside Radix `Tabs.Content` with `forceMount`, and toggling visibility with `data-[state=inactive]:hidden` + a `lg:` override — a pure-CSS technique with zero JS breakpoint detection. That works because each `Tabs.Content` panel holds **different** content (results vs. chat) — there's no risk of the _same_ component appearing twice, because there's nothing to duplicate.

The history sidebar's problem is different: the **same** `HistoryList` needs to appear either inside a static `<aside>` (`≥lg`) or inside a `<Sheet>` (`<lg`) — genuinely the same content in two different structural wrappers, not two different panels. A pure-CSS `hidden`/`lg:block` toggle on the `<aside>` alone does **not** solve this, because Tailwind's `hidden` is `display:none` — the element (and everything inside it, including every row's `data-testid`) **stays in the DOM**, just invisible. If a mobile user then opens the `<Sheet>` (which mounts its own, separate copy of `HistoryList` on open — Radix's default, non-`forceMount` behavior), **two** copies of every row's `data-testid` now exist simultaneously, and Playwright's `getByTestId()` throws a strict-mode violation the moment Story 5.2 writes a POM against this component (the sheet-open, mobile-viewport case is exactly the scenario Story 5.2's dedicated mobile Playwright project will exercise).

**The fix used here (Task 7):** gate the `<aside>`'s inner `HistoryList` on `!mobileOpen` — the exact same boolean that drives the `<Sheet>`'s `open` prop. At `≥lg` the trigger that could set `mobileOpen = true` is `lg:hidden` (unreachable), so the aside always renders and the sheet never opens — one copy. At `<lg`, opening the sheet flips `mobileOpen` to `true`, which simultaneously (a) mounts the sheet's copy and (b) unmounts the aside's copy — still one copy, at every instant. This is **not** a viewport-detection hook (the kind Story 3.2 rightly warned against for hydration-mismatch risk) — `mobileOpen` starts `false` identically on server and client and only ever changes via a real click event on a button that literally cannot be reached at `≥lg`, so there is no server/client disagreement possible. It is a deliberate, documented divergence from Story 3.2's exact pattern, justified by the different underlying problem (shared content in two wrappers vs. distinct content in two panels).

### Retry does not auto-resubmit

EXPERIENCE.md's history-sidebar state table says a `failed` row's retry affordance "starts a fresh session from the same URL." Read literally as "automatically re-`POST /sessions`," this would (a) require the summary payload to carry `strategy`/`provider`/`model`/`questionCount`, none of which AC #2's minimal wire schema exposes (deliberately — epics.md's literal AC only asks for source URL, status, created date), and (b) silently spend `POST /sessions`'s 5/min budget (NFR-2) without an explicit user action confirming the retry, which conflicts with EXPERIENCE.md's own "no fabricated confidence" principle and with how Story 2.7's landing-page retry already works (it resubmits **preserved, user-visible** form values, not a blind background call). **Resolution used here:** retry prefills the landing form's URL field with the failed session's `sourceUrl` and focuses it (Task 6); the user reviews/adjusts strategy, provider, etc., and clicks **Start** themselves, same as any other session creation. This is the same "starts a fresh session from the same URL" outcome, just user-confirmed rather than silent.

### Pagination contract

`GET /api/sessions?limit=20&before=2026-07-15T09:00:00.000Z` → `{ sessions: SessionSummarySchema[], hasMore: boolean }`. `before` is the `createdAt` of the last row the client has already seen (omitted on the first page). `limit` defaults to 20, capped at 50. This mirrors Story 4.1's `ChatHistoryResponseSchema`/`before?: Date` pagination idiom deliberately, for consistency across the app's two "recent N + load more" surfaces (chat messages, session history) — neither uses `LIMIT`/`OFFSET` query semantics on the wire, even though the SQL implementation does use `LIMIT` internally (Task 2).

### `GET /api/sessions` vs. `architecture-spec.md`'s `GET /api/users/me/sessions` — resolved in favor of the former

`architecture-spec.md` §A.6's REST API table lists the history endpoint as `GET /api/users/me/sessions`, a **temporary pre-implementation reference** (its own frontmatter: `status: temporary-pre-implementation`). epics.md's binding Story 5.1 AC text says `GET /sessions` (no `:id`) and every prior story (1.4, 2.6, 3.1) has built the collection under `sessions.controller.ts` (`@Controller('sessions')`, global prefix `api` → `/api/sessions`, `/api/sessions/:id`). Adding `GET /api/sessions` as the list route alongside the existing `GET /api/sessions/:id` detail route is the natural, zero-conflict extension of that established controller (different path shapes, no NestJS route-ordering issue) and matches epics.md's literal AC. **This story follows `GET /api/sessions`**, not the architecture-spec sketch — the same category of resolution Story 1.4 made for "identity middleware" vs. `identity.interceptor.ts` and for the `/api`-prefixed route form.

### Previous story intelligence

- **Story 1.3** created `idx_quiz_sessions_user_id_created_at ON quiz_sessions (user_id, created_at DESC)` specifically "consumed by Story 5.1" (its own AC #10 says so). This story is that consumer — do not add a second index; the existing one already covers both the `WHERE user_id = ?` filter and the `ORDER BY created_at DESC` this story's query needs.
- **Story 1.4** established the `X-User-Id` → `users.external_id` → `users.id` translation and the ownership pattern this story's list route reuses (filtering by the internal `users.id` from ALS context, never the raw header). It also established that `GET /sessions/:id` already returns 404 for cross-user access — this story adds a regression test for the **list** route's scoping, not new server logic for the item route.
- **Story 2.7** built the entire FE substrate (`lib/api.ts`, `lib/queries.ts` factory, `UserProvider`, `components/states/*`, `@theme` tokens, `session-form.tsx`) and **explicitly reserved** `EmptyState` for this story's reuse in its own Dev Notes. This story extends `page.tsx`, `session-form.tsx`, and `lib/queries.ts` rather than forking parallel versions.
- **Story 3.2** established the "single-mount responsive shell" convention (see "Avoiding duplicate mounts" above for why this story diverges from its exact `Tabs.Content forceMount` technique while keeping its underlying goal) and confirmed the history sidebar does not appear on `/result/[id]`.
- **Story 3.3** built `quiz-pending-state.tsx` anticipating this story's resume-from-history flow (see "Reconciling Story 3.3's `pending`-state gap" above) — the single most direct forward-reference this story resolves.
- **Story 4.1** established the `{items, hasMore}` / `before?: Date` pagination idiom this story's list endpoint mirrors.

### Data model — none added

This story adds **no new table and no new migration**. It reads the existing `quiz_sessions` table (Story 1.3) through the existing `idx_quiz_sessions_user_id_created_at` index (Story 1.3) and the existing RLS policy on `quiz_sessions` (Story 1.4's migration `0001`, `user_owns_session`) as the database-layer backstop — the app-layer `WHERE user_id = ?` filter (Task 2) is the primary control, same as every other session-scoped read in this app. If a dev agent finds themselves writing `ALTER TABLE` or generating a new migration for this story, that is a sign of scope drift — stop and re-read this section.

### Design tokens — reuse only, no new tokens

`{colors.accent}` focus ring, `EmptyState`/`Skeleton` primitives, `md`/`lg` breakpoint tokens — all already wired by Story 2.7. This story is the first consumer of shadcn `Sheet` (Task 7); no other `@theme` additions are needed.

### Testing standards summary

- **Vitest.** API integration test for the list endpoint's scoping/pagination/ordering (`apps/api/test/integration/`), an ownership regression test (`apps/api/test/security/`), and FE component tests for `HistoryList`/`HistoryRow`/`HistorySidebar` (`apps/web`'s existing Vitest project from Story 2.7 — extend, don't add a new runner).
- **No Playwright work in this story** — the mobile-viewport project and any `.spec.ts` assertions belong to Story 5.2.
- Coverage floors (NFR-4/AD-N10): this story adds a repository method (not a use-case), so the ≥ 60% adapter floor applies, not the ≥ 80% use-case floor.
- Run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test && pnpm --filter @ai-quiz/web test` before marking done; `pnpm verify` remains the overall gate.

### Project Structure Notes

```
apps/api/src/
  domain/ports/quiz-repository.port.ts             UPDATE (Story 1.4) — add listForUser(...)
  adapters/persistence/drizzle/
    quiz-session.repository.ts                      UPDATE (Story 1.4) — implement listForUser
  driving/sessions/sessions.controller.ts           UPDATE (Story 1.4/2.6/3.1) — add GET /sessions
apps/api/test/
  integration/sessions-list.integration.test.ts     NEW
  security/ownership-list.security.test.ts          NEW
packages/shared/src/schemas.ts                      UPDATE — SessionSummarySchema, ListSessionsQuerySchema, SessionsListResponseSchema

apps/web/
  app/page.tsx                                      UPDATE (Story 2.7) — two-pane grid, prefillUrl state
  components/
    landing/session-form.tsx                        UPDATE (Story 2.7) — accept prefill prop + focus
    history/
      history-sidebar.tsx                           NEW — mobileOpen state, aside/sheet gating (Task 7)
      history-list.tsx                               NEW
      history-row.tsx                                NEW
      history-row-skeleton.tsx                        NEW
    ui/sheet.tsx                                     NEW — shadcn Sheet, first consumer
  lib/queries.ts                                     UPDATE (Story 2.7) — queryKeys.sessions.list, useSessionsInfiniteQuery, invalidate-on-create
```

Do **not** create `apps/web/app/quiz/`, `apps/web/app/result/`, or touch `apps/web/lib/sanitize.ts` — no work in this story reaches those surfaces.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1: Session history & revisit] — binding ACs (and the stale `md` breakpoint text, resolved above)
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 5: Revisit history on any device] — epic framing; "any device" scope clarified above
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements → Shared UI conventions] — `lg` = 1024px structural boundary (corrected 2026-07-20), explicitly binding this story
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#UJ-3, #FR-8, #NFR-5] — revisit journey, ownership, FE state
- [Source: .../ARCHITECTURE-SPINE.md#AD-21 — Single structural breakpoint] — names this story explicitly, `[AMENDED 2026-07-20]`
- [Source: .../ARCHITECTURE-SPINE.md#AD-9 — Ownership per request + Postgres RLS] — identity translation, index cost note ("uses the same `idx_quiz_sessions_user_id_created_at` index as the app-layer filter")
- [Source: .../ARCHITECTURE-SPINE.md#AD-17 — FE state split] — Context/TanStack Query rules this story's `prefillUrl` state stays within
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.3, #A.6] — `listByUserId` sketch, REST route table (superseded by the `GET /api/sessions` resolution above)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/DESIGN.md#Layout & Spacing (Breakpoints), #Components] — `lg` breakpoint table, no-red rule, shadcn `Sheet` inheritance
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/EXPERIENCE.md#Information Architecture, #State Patterns → History sidebar, #Trust & Disclosure, #Key Flows → UJ-3] — IA table (sidebar only on `/`), per-status row behavior, exact empty-state copy, "any device" journey text
- [Source: _bmad-output/project-context.md#Frontend state] — state substrate rules
- [Source: _bmad-output/implementation-artifacts/1-3-api-skeleton-db-foundation-and-health-endpoints.md] — `idx_quiz_sessions_user_id_created_at`, explicitly built for this story
- [Source: _bmad-output/implementation-artifacts/1-4-per-session-ownership-walking-skeleton-sessions-endpoint.md] — identity/ownership pattern, `X-User-Id` translation this story's list route reuses
- [Source: _bmad-output/implementation-artifacts/2-7-landing-page-and-quiz-start-flow.md] — FE substrate reused/extended; `EmptyState` reserved for this story
- [Source: _bmad-output/implementation-artifacts/3-2-result-page-dual-panel-shell-results-panel.md] — single-mount responsive-shell precedent (and why this story's technique differs), confirmed no sidebar on `/result/[id]`
- [Source: _bmad-output/implementation-artifacts/3-3-quiz-taking-ui-one-question-at-a-time.md] — the `pending`-state gap this story's resume flow reconciles
- [Source: _bmad-output/implementation-artifacts/4-1-chat-backend-persistence-pre-submit-guard.md] — `{items, hasMore}`/`before` pagination idiom this story mirrors

### Open questions / spec gaps (non-blocking — flagged for the human)

1. **"Any device" is a naming imprecision in epics.md's story title**, not a functional gap — flagged prominently above so no dev agent (or reviewer) mistakes it for an unspecified cross-device-sync requirement. If product actually wants cross-device history later, it needs real auth (out of v1 scope, PRD §5).
2. **`architecture-spec.md`'s `GET /api/users/me/sessions` route name is stale** relative to the `GET /api/sessions` this story (and the existing `sessions.controller.ts`) actually implements — flagged for whoever next revises that temporary reference document; not fixed here (out of this story's file-scope, same convention Story 3.1/3.2 used for their own flagged spine/spec residue).
3. **Whether a submitted session's row should show `finalScore` inline** (e.g., "2.8/4") is not specified by any source document — epics.md's literal AC only asks for source URL, status, and created date. This story deliberately does not add it (Task 1's minimal `SessionSummarySchema`) to avoid inventing UI beyond what's asked; a future story could extend the wire schema if product wants it, without needing a new migration (the data already exists on `quiz_sessions.final_score`).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
