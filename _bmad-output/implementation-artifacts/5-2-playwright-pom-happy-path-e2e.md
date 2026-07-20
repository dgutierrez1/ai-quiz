# Story 5.2: Playwright POM + happy-path E2E

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the end-to-end suite with Page Object Model covering the full journey,
so that regressions in the user flow are caught before release.

## Acceptance Criteria

_(NFR-4, AD-N10, SM-3; breakpoint value corrected 2026-07-20 — see Dev Notes)_

1. **POM classes exist and are the only way specs touch the DOM.** Given `apps/web/e2e/pages/`, then `BasePage`, `LandingPage`, `QuizPage`, `ResultPage` classes exist (`ResultPage` also owns chat-panel locators/actions — chat lives inside the result-page shell per Story 3.2/4.3, and epics.md names exactly these four classes, not a fifth `ChatPage`), and `landing.spec.ts`/`full-quiz.spec.ts`/`chat.spec.ts` import and use them exclusively.
2. **Selector discipline.** Given any spec or POM method, then it calls `page.getByTestId(...)` only — no CSS selectors, no `page.locator('.class')`, no text matchers for anything the app already exposes a `data-testid` for.
3. **`@ai-quiz/require-data-testid` ships with `RuleTester` fixtures.** Given a JSX interactive element (native `button`/`input`/`select`/`textarea`/`a`, or this codebase's interactive shadcn/Radix component names — `Button`, `Input`, `Select`/`SelectTrigger`, `RadioGroupItem`, `Checkbox`, `TabsTrigger`, `Link`) with no `data-testid` attribute, then the ESLint rule fails the build. It ships known-good and known-bad fixtures plus its own `RuleTester` unit test — the same fixture-driven pattern Story 1.4 established for `@ai-quiz/no-unscoped-session-query` — and is wired into root `eslint.config.js`, scoped to `apps/web/**/*.tsx`.
4. **`landing.spec.ts`.** Given `landing.spec.ts`, then it covers URL entry, provider/model dropdown population and selection, strategy selection (asserting no pre-selected value), the `questionCount` control, and Start — asserting `POST /api/sessions` fires and the app routes toward `/quiz/[id]` on a `ready` response. `POST /api/sessions` is network-intercepted (Dev Notes → LLM-avoidance) so this spec never waits on a real backend generation call.
5. **`full-quiz.spec.ts` — canonical happy path.** Given a deterministically seeded `ready` session (Dev Notes → LLM-avoidance), then it answers every question, submits, and lands on `/result/[id]`, asserting `finalScore`, `categoryBreakdown` (rendering one `strong`, one `mixed`, and one `weak` chip by fixture design), and `insights.topicsToStudy` render inline (UJ-1) — with zero live LLM calls anywhere in this spec.
6. **Single-mount DOM guardrail.** Given the result page's dual-panel/tabs responsive switch (Story 3.2 AC #11's `Tabs.forceMount` + `data-state` pattern), then `full-quiz.spec.ts` asserts the results panel and the chat-slot/chat-panel each resolve via `getByTestId(...)` to **exactly one** element at both the `desktop` and `mobile` Playwright projects (Playwright throws on a strict-mode 2+-match locator automatically) — this is the concrete regression test for Story 3.2's documented DOM trap: two separate JSX subtrees (one per breakpoint) would fail this assertion immediately.
7. **`chat.spec.ts`.** Given a submitted session (produced via a direct API submit call in test setup, never by re-driving the UI a second time), then it covers (a) the client-side-only "Explain Qn" prefill — exact template string, focus + caret placement, tab-switch-first on `<lg` — which needs no LLM call and always runs, and (b) one post-submit message receiving an assistant reply (role, non-empty content, arrival within a generous timeout) — the suite's single deliberate, cost-bounded live LLM call, skipped automatically when no provider key is present (Dev Notes → LLM-avoidance).
8. **Mobile viewport project, corrected breakpoint.** Given a Playwright project whose viewport width sits below the shared **structural** breakpoint — **`lg` = 1024px**, integer literal `1024` (see Dev Notes → Breakpoint correction; do **not** use the stale `md`/768px value still present in epics.md's own un-patched Story 5.2 AC text) — then `full-quiz.spec.ts` passes at that viewport with the result page rendered as `Tabs` (Results/Chat) instead of the dual-panel grid, and the landing page's history affordance (where reachable) as a slide-out rather than a persistent sidebar column. The viewport width is a single exported constant, never a literal duplicated in more than one file.
9. **CI run order + tracked budget.** Given CI, then the run order is `packages/shared` → `apps/api` → `apps/web` (Playwright), wired via a new `.github/workflows/ci.yml` (separate from Story 1.6's `keep-warm.yml` cron workflow) that runs on push/PR; each stage's wall-clock is emitted into the job summary as a tracked budget (Vitest ~30s, Playwright ~2min) — a regression signal, not a hard-coded timing assertion inside a test (which would flake).
10. **Root and `apps/web` scripts do real work.** Given the root `package.json`'s `test:e2e` script (a stub since Story 1.1: `echo '… deferred to Story 5.2 …' && exit 0`) and `apps/web/package.json`'s equivalent stub, then both invoke the real Playwright runner, and `pnpm verify` exercises the full suite end-to-end on a clean environment with Postgres reachable.
11. **Gap-analysis/insights test-result side-channel (NFR-4).** Given the standard `full-quiz.spec.ts` run, then its submit step attaches a `testInfo` annotation carrying the real `categoryBreakdown`/`insights` payload from the actual submit response — satisfying NFR-4/AD-N10's "test results include gap analysis + insights" as a side effect of the normal pass, with no separate test run.
12. **Submit-contract divergence is documented, not silently re-derived.** Given Stories 3.1 (authoritative owner), 3.2, and 3.3 were authored concurrently, then this story's fixtures/specs are built against Story 3.1's actual `packages/shared/src/schemas.ts` exports (`SubmitRequestSchema`, `SubmitResponseSchema`, `QuestionResultSchema`, `InsightsSchema`) — never a fourth re-derived shape — and every point of disagreement between the three stories is recorded precisely in Dev Notes → "Submit contract reconciliation," including the one genuine, unresolved gap (`QuestionResultSchema` carries no `selected` field, so this suite cannot assert a "you picked this" UI mark).
13. **DB seed helper respects RLS.** Given the Playwright fixtures need a deterministic `ready`/`submitted` session without a live LLM call, then the seed helper writes through the same `set_config('app.user_id', …, true)` transaction-scoped pattern `identity.interceptor.ts` uses (Story 1.4) — never a superuser bypass, never a disabled-RLS connection — so fixture data is provably reachable under the exact security model production traffic uses.
14. **Scope boundary held.** Given Story 5.3 owns the cross-user isolation/security E2E sweep (`security.spec.ts`) and the README, then this story introduces neither — no second `X-User-Id` value appears anywhere in this story's fixtures or specs, and no README file is touched.

## Tasks / Subtasks

- [ ] **Task 1 — Playwright install + config** (AC: #1, #8, #10)
  - [ ] Add `@playwright/test@1.61.1` (pinned per `ARCHITECTURE-SPINE.md#Stack`) to `apps/web`'s devDependencies; `pnpm --filter @ai-quiz/web exec playwright install --with-deps chromium`. Chromium-only for v1 — no cross-browser AC exists anywhere upstream; record this as a scope decision, not an oversight.
  - [ ] `apps/web/playwright.config.ts` — `testDir: './e2e/tests'`, two projects: `desktop` (viewport ≥1024, e.g. 1280×800) and `mobile` (viewport width < 1024 — see Task 8's shared constant). `webServer` config boots `apps/api` (built, `DATABASE_URL` pointed at the docker-compose Postgres from Story 1.1, migrations applied) and `apps/web` (`next dev`/`next start` with `NEXT_PUBLIC_API_URL` pointed at the api's port) before tests run; `reuseExistingServer: !process.env.CI` for local iteration speed.
  - [ ] Reuse the existing `apps/web/e2e/{pages,fixtures,tests}` directories — Story 1.1 already scaffolded these (empty, `.gitkeep`'d). Do not create a parallel directory structure.

- [ ] **Task 2 — Fixture markdown doc + fixed question pool** (AC: #5, #7, #8)
  - [ ] `apps/web/e2e/fixtures/fixture-doc.md` — a small, hand-written markdown document with ≥4 clearly headed sections. Used **only** as the seeded `documents.content_markdown`/`chunks` value — this story's specs never actually fetch or chunk it through the real ingestion pipeline (that pipeline is Epic 2's, already covered by its own Vitest suites).
  - [ ] `apps/web/e2e/fixtures/question-pool.ts` — a fixed array of ≥8 questions (mix of `single`/`multiple`, 4 answers each) tagged across exactly 4 categories, 2 questions per category, with text that genuinely token-overlaps `fixture-doc.md` (keeps the fixture honest — nothing in this story invokes the real grounding check, but a genuinely grounded fixture stays reusable if a later change swaps in real generation).
  - [ ] Fix the answer key so driving the UI to answer 2 questions correctly in category A, 2 correctly in category B, both wrong in category C, and split 1/1 in category D produces exactly one `strong`, one `weak`, and one `mixed` `categoryBreakdown` entry deterministically (AC #5) — this exercises `strengthFor`'s real thresholds (Story 1.2) with zero randomness.

- [ ] **Task 3 — DB seed helper** (AC: #5, #7, #13)
  - [ ] `apps/web/e2e/fixtures/seed-session.ts` — a standalone Node module using a raw `pg` client against `DATABASE_URL` (no Drizzle import — keeps this story's fixtures independent of `apps/api`'s internal module graph). Exports:
    - `seedReadySession(userExternalId: string): Promise<{ sessionId: string; answerKey: Map<questionId, correctPositions[]> }>` — upserts the `users` row by `external_id` (`DO UPDATE`, mirroring Story 1.4's race-safe idiom even though no concurrency exists here), opens one transaction, `SELECT set_config('app.user_id', <users.id>, true)`, inserts `quiz_sessions` (`status='ready'`, fixed `strategy`/`question_count`, placeholder `provider`/`model` — never invoked), `documents` (Task 2's fixture doc), `questions`/`answers` (Task 2's fixed pool, `is_correct` per the fixture key), commits, returns the session id and the answer key. **`is_correct` never crosses into anything the browser can read** — the map is Node-side test code only, exactly mirroring how the real app keeps `is_correct` server-side pre-submit.
    - `submitViaApi(sessionId: string, userExternalId: string): Promise<void>` — calls the real `POST /api/sessions/:id/submit` directly over HTTP (not through the browser) using the fixed answer key, producing a genuinely `submitted` session for `chat.spec.ts` without re-walking the quiz UI and without hand-maintaining a second copy of `user_responses`/`knowledge_categories`/`insights` fixture rows — this exercises Story 3.1's real scoring/insights code path, so the chat-prerequisite session is exactly as production-shaped as one a real user produced.
  - [ ] Each test gets its **own freshly seeded session** (fresh UUID per call, in `test.beforeEach`, not a shared/global session) — Playwright runs spec files in parallel workers by default; sharing one row across files/tests risks races on `user_responses`'s `UNIQUE(session_id, question_id)` constraint or on submit's atomic-UPDATE mutex.

- [ ] **Task 4 — POM classes** (AC: #1, #2)
  - [ ] `apps/web/e2e/pages/base-page.ts` — `BasePage { constructor(protected page: Page) {} }` + a `gotoWithUserId(path: string, userExternalId: string)` helper that seeds `localStorage`'s UUID key before navigation, so tests can drive the browser under a **known** `X-User-Id` matching whatever `seed-session.ts` wrote (Story 2.7's `<head>` script only self-generates a UUID if none is already present).
  - [ ] `apps/web/e2e/pages/landing-page.ts` extends `BasePage` — locators/actions for the URL input, topic input, strategy picker, provider/model selects, `questionCount` control, Start button, error/rate-limited states, and (best-effort, provisional — see Dev Notes) the history sidebar/slide-out toggle.
  - [ ] `apps/web/e2e/pages/quiz-page.ts` extends `BasePage` — `answerOption(position)`, `nextButton`, `submitButton`, `positionIndicator`, `shortfallNote`, and a composed `answerAllAndSubmit(answerKey)` helper.
  - [ ] `apps/web/e2e/pages/result-page.ts` extends `BasePage` — score display, per-category strength chips, per-question breakdown, and the chat-panel locators (thread, input, send, quick-action chips, `explain-question-{n}` per Story 4.3's naming scheme, tab triggers for `<lg`).
  - [ ] Every locator method calls `this.page.getByTestId(...)` exclusively.

- [ ] **Task 5 — `landing.spec.ts`** (AC: #4)
  - [ ] Intercept `POST /api/sessions` via `page.route('**/api/sessions', …)`, returning a fast canned `{id, status: 'ready'}` — the real backend never generates anything for this spec. Let `GET /api/config/providers` hit the real (LLM-free, cheap) endpoint rather than mocking it too, so this spec also catches a Story 2.3 regression in the provider list.
  - [ ] Cover: URL entry + validation, provider→model dependent select, strategy picker has no pre-selected value, `questionCount` defaults to 8, Start stays disabled until valid, in-flight narration appears, successful Start navigates toward `/quiz/[id]`.

- [ ] **Task 6 — `full-quiz.spec.ts`** (AC: #5, #6, #11)
  - [ ] `test.beforeEach`: `seedReadySession(...)`, then `landingPage.gotoWithUserId('/quiz/' + sessionId, userExternalId)` — starts directly from a known session (Task 5 already covers the landing→quiz handoff at the network-intercept layer, so this isn't a coverage gap).
  - [ ] Answer every question per the seeded answer key (mixing `single`/`multiple`), submit, assert navigation to `/result/[id]`.
  - [ ] Assert `finalScore` renders; `categoryBreakdown` shows exactly the designed one-`strong`/one-`mixed`/one-`weak` chip set; `insights.topicsToStudy` narrative renders for the weak category.
  - [ ] Single-mount guardrail (AC #6): run this spec under both the `desktop` and `mobile` projects and assert `getByTestId(...)` for the results panel and the chat slot/panel each resolve without a strict-mode error at both viewports.
  - [ ] Attach the `testInfo` annotation carrying `categoryBreakdown`/`insights` from the real submit response (AC #11).

- [ ] **Task 7 — `chat.spec.ts`** (AC: #7)
  - [ ] `test.beforeEach`: `seedReadySession` → `submitViaApi` → navigate straight to `/result/[id]` for the now-submitted session.
  - [ ] Explain-Qn prefill (no network, always runs): click a question's `explain-question-{n}` control; assert the chat input is pre-filled with the exact template string from Story 4.3 AC #7 (`Explain question {n} — I answered {correctly|incorrectly}: {selection}`) and that focus/caret land in the input; on the `mobile` project, additionally assert the shell switches to the Chat tab first.
  - [ ] Live send/receive (the suite's one deliberate LLM call): `test.skip(!process.env.MINIMAX_API_KEY && !process.env.OPENROUTER_API_KEY, 'no LLM provider key configured')`; send a message, assert an assistant message appends (role, non-empty content) within a generous timeout (`test.slow()` or an explicit `{timeout: 45_000}`) — structural assertions only, never exact wording, since the reply is genuinely non-deterministic.

- [ ] **Task 8 — Mobile viewport project** (AC: #8)
  - [ ] `apps/web/e2e/fixtures/viewports.ts` exports the single mobile-viewport constant (width < 1024 — e.g. `{ width: 390, height: 844 }`), imported by `playwright.config.ts`'s `mobile` project. Never a second hardcoded width anywhere else in this story's files.
  - [ ] Run `full-quiz.spec.ts` under both projects (Playwright natively re-runs a spec per project — no separate mobile-only spec file needed for the core happy path).
  - [ ] Sidebar slide-out assertion: **provisional** — Story 5.1 (history sidebar) has no story file yet as of this writing. Treat its `data-testid` names as coordinate-during-implementation, the same way Story 4.3 handled its then-unwritten dependency on Stories 3.2/4.1. If 5.1 hasn't landed a concrete sidebar/slide-out `data-testid` by the time this story is implemented, scope this specific assertion down to "history affordance absent/hidden gracefully" rather than blocking the story on an unauthored dependency.

- [ ] **Task 9 — `@ai-quiz/require-data-testid` ESLint rule** (AC: #2, #3)
  - [ ] Add the rule to `packages/eslint-plugin-local/src/` following whatever file/registration structure Story 1.4's `no-unscoped-session-query` established — **read that file before writing this one**; do not invent a second plugin-authoring convention.
  - [ ] Detect JSX elements whose tag name is in a configured interactive-element list (`button`, `input`, `select`, `textarea`, `a`, plus this codebase's shadcn/Radix component names: `Button`, `Input`, `Select`/`SelectTrigger`, `RadioGroupItem`, `Checkbox`, `TabsTrigger`, `Link`) with no `data-testid` JSX attribute; report it. Document the known limitation inline: a spread (`{...props}`) is "cannot statically verify," skipped rather than flagged — the same class of edge the `no-unscoped-session-query` rule accepts for raw SQL outside ESLint's reach.
  - [ ] `RuleTester` unit test: valid fixtures (interactive elements with `data-testid`; non-interactive elements without), invalid fixtures (each interactive tag in the list missing `data-testid`).
  - [ ] Wire into root `eslint.config.js`, scoped to `apps/web/**/*.tsx` only.
  - [ ] Run `pnpm run lint:check` against the already-hand-annotated `apps/web` component tree (Stories 2.7/3.2/3.3/4.3 all applied `data-testid` by hand per their own ACs). Expect it to pass; any failure is a real gap in an earlier story's hand-applied attributes — fix it as a small, scoped patch (add the missing attribute), not a redesign.

- [ ] **Task 10 — CI wiring** (AC: #9, #10)
  - [ ] Replace root `package.json`'s `test:e2e` stub with `pnpm --filter @ai-quiz/web test:e2e`.
  - [ ] Replace `apps/web/package.json`'s `test:e2e` stub with `playwright test`.
  - [ ] New `.github/workflows/ci.yml` (a separate file from Story 1.6's `keep-warm.yml` — do not fold checks into the cron workflow) — on `push`/`pull_request`: spin up a Postgres 16 service container matching `docker-compose.yml`'s `postgres:16.14-alpine`, apply migrations, then run `pnpm --filter @ai-quiz/shared test`, `pnpm --filter @ai-quiz/api test`, `pnpm --filter @ai-quiz/web test:e2e` (installing Playwright browsers first) in that order (AD-N10); echo each stage's wall-clock into `$GITHUB_STEP_SUMMARY` as a tracked-budget line, not a pass/fail timing assertion.
  - [ ] Note (in code comments, not the README — Story 5.3 owns that) that a local `pnpm verify` run needs `DATABASE_URL` pointed at the docker-compose Postgres and, only for `chat.spec.ts`'s live-send test, a provider key in `.env`.

- [ ] **Task 11 — Sanity pass** (AC: all)
  - [ ] Run the full suite locally against docker-compose Postgres at least once before marking done; confirm `pnpm verify` is green end-to-end on a clean environment.
  - [ ] Confirm the `mobile` project's `full-quiz.spec.ts` run actually observes the `Tabs` collapse (assert `data-state`/`aria-selected` on the tab triggers, or equivalent) — not merely "passes coincidentally because the assertions happen to hold at any width."

## Dev Notes

### 🚨 Scope boundary — read first

| Belongs to | NOT this story | Why |
|---|---|---|
| **Story 5.1** (no file yet) | History sidebar implementation, its exact `data-testid` names | This story's mobile-project sidebar assertion is provisional against 5.1 — see Task 8. |
| **Story 5.3** | `security.spec.ts` (two `X-User-Id` values, cross-user 404s on every route), RLS-unset-GUC-returns-0-rows verification, the README | Explicitly named in the launch instructions as out of scope here. No second identity value appears anywhere in this story's fixtures. |
| **Story 3.1** | `POST /submit` implementation, scoring, `insights`/`categoryBreakdown` computation | This story consumes Story 3.1's real code via `submitViaApi`/the UI flow — it does not reimplement or duplicate scoring logic in a fixture. |
| **Epic 1–4 UI stories (2.7, 3.2, 3.3, 4.3)** | Applying `data-testid` attributes to their own components | Already done by hand, per each story's own AC. This story only builds the **enforcing** lint rule and the specs that consume those attributes. |
| **Epic 2 (2.1–2.6)** | Real quiz generation (ingest, neutralize, chunk, LLM call, grounding, stratified draw) | Deliberately bypassed by this story's DB-seed strategy — already covered by Epic 2's own Vitest integration suites and by SM-1's manual demo-run criterion. |
| **Any story** | Adding a new LLM provider, changing `GET /api/config/providers`, or any backend DI seam to swap `LlmPort`'s implementation for tests | Considered and rejected in favor of DB seeding — see "LLM-avoidance strategy" below. Introducing a test-double provider binding would be new `apps/api` composition-root wiring, arguably crossing into "changing the provider list" territory that `project-context.md` flags as stop-and-ask; this story avoids that trip-wire entirely by never touching `apps/api` production code. |

### Submit contract reconciliation (the single most load-bearing section in this story)

Stories 3.1, 3.2, and 3.3 were authored concurrently — 3.1 didn't exist yet when 3.2/3.3 were written, so both reconstructed the `POST /submit` contract independently. Read all three before writing a single fixture. Findings, in order of how much they matter to this suite:

1. **Request shape — consistent, no action needed.** 3.1 (`packages/shared/src/schemas.ts` Task 1, `SubmitRequestSchema`): `{ responses: [{ questionId: uuid, selected: number[] (non-empty, unique positions 0–3) }] }`. 3.3's independently reconstructed shape (`3-3-…md` Dev Notes → "`POST /api/sessions/:id/submit` — request/response contract") matches it exactly, field-for-field. Build this suite's request bodies against 3.1's actual exported schema, never a re-derived shape.

2. **Response envelope — consistent at the top level.** `{sessionId, finalScore, actualCount?, breakdown[], categoryBreakdown[], insights{...}}` — 3.1's `SubmitResponseSchema` and 3.3's reconstruction agree.

3. **`insights.strengthByCategory` type — genuinely divergent in the docs, but harmless in practice.**
   - **3.1 (authoritative — its Task 1, and its own AC #7 names this explicitly as "the bug fix"):** `Record<categoryName, 'strong'|'mixed'|'weak'>` — an object map. 3.1's dev notes state the PRD's literal TypeScript sketch showed a bare scalar and calls that "a probable shape bug" it resolves.
   - **3.2 (`3-2-…md` Dev Notes → "API contract this story consumes"):** documents the *old*, pre-fix shape — `strengthByCategory: 'strong' | 'mixed' | 'weak'` (a single scalar) — but explicitly flags it: *"per PRD text this is 'per-category' but typed as a single enum — likely a spec typo; do not build a UI dependent on it."* 3.2's actual component plan never reads `insights.strengthByCategory` at all; it uses `categoryBreakdown[].strength` instead (the unambiguous field). So the stale prose never became a UI dependency.
   - **3.3's own reconstruction** (`3-3-…md`) shows `"strengthByCategory": {}` in its example JSON — an empty object, implicitly agreeing with 3.1's map shape, not 3.2's scalar description.
   - **This story's stance:** treat 3.1's `Record<string, 'strong'|'mixed'|'weak'>` as authoritative. Task 2's fixed answer key must produce a `categoryBreakdown` where the strength labels are read via `categoryBreakdown[].strength` (matching 3.2's actual implementation), and if this suite ever asserts on `insights.strengthByCategory` directly, assert it as an object map keyed by category name. **Flag for a human:** Story 3.2's Dev Notes prose (not its code) should be corrected to cite 3.1's resolved shape — a documentation-only fix, zero functional impact.

4. **`breakdown[]` has no `selected` field — a genuine, unresolved gap, not just a naming mismatch.**
   - 3.1's `QuestionResultSchema` (its Task 1, authoritative, literally enumerated): `{ questionId, position, rawScore, weight, weightedScore, correctAnswers }`. **No `selected` field anywhere in this schema.**
   - 3.2 (`3-2-…md` AC #8 + Dev Notes) wants to render "the user's own selection marked… where the payload carries it," and explicitly builds defensively for its absence: *"if the actual payload doesn't carry `selected` per response, the breakdown still shows question text, all 4 answers, and which are correct, just without a 'you picked this' mark."*
   - The underlying data exists — `user_responses.selected` is a real column (`jsonb`, positions 0–3) that 3.1's `getSubmittedResult` port already joins against for `breakdown[]`/`correctAnswers` — but the **wire schema** as literally authored never surfaces it. This is not a rename-the-field fix; it's a missing field in a pinned, "authoritative" contract.
   - **This story's stance, and the one binding decision the E2E suite makes:** `full-quiz.spec.ts` does **not** assert that the result page marks the user's own selected answer — because Story 3.1's schema, as written, cannot deliver that. This matches 3.2's own graceful-degradation design, so nothing in this suite is "testing a bug"; it's declining to test a feature the contract doesn't yet promise. **Flag for a human:** decide whether to amend `QuestionResultSchema` (add `selected: PositionSetSchema`) before Story 3.2 is implemented — if it lands, add the assertion here as a small follow-up, don't silently skip it forever.

5. **`GET /sessions/:id`'s submitted-branch nested question projection — resolved, not divergent.** 3.2 flagged this as an open upstream gap ("is `selected` per response nested? is the full question/answer text nested?"). 3.1 resolves it via `RevealedQuestionResponseSchema` merged with the submit fields, matching the shape 3.2's own "working assumption" already anticipated. No suite-level action needed beyond building fixtures against 3.1's actual export name.

6. **Route prefix — consistent.** `/api/sessions/:id/submit`, `/api/sessions/:id` throughout 1.4/3.1/3.2/3.3. No divergence.

7. **A minor, separate doc inconsistency worth flagging (not a submit-contract issue):** Story 4.3's Dev Notes (§"Architecture compliance checklist") states *"the lint rule itself was built earlier … and should already be enforcing this"* — referring to `@ai-quiz/require-data-testid`. This contradicts the consistent resolution Stories 1.1, 2.7, 3.2, and 3.3 all independently reach: the **enforcing** rule is Story 5.2's (this story's), and every earlier UI story applies attributes by hand without it running yet. Not a blocker for this story — just note it for whoever next touches 4.3's file.

### Breakpoint correction — already resolved 2026-07-20

`ARCHITECTURE-SPINE.md#AD-21` now carries `[AMENDED 2026-07-20 — lg supersedes md]` and reads: *"Collapse at Tailwind's built-in `lg` token — `--breakpoint-lg`, `64rem` (= 1024px)… `md` = 768px remains legal but is NON-STRUCTURAL."* `epics.md`'s "Shared UI conventions" section was corrected the same day to match. **What was not patched:** epics.md's own literal Story 5.2 AC bullet (*"a Playwright mobile viewport project sized below the shared `md` breakpoint (768px)… sidebar → slide-out"*) still names the stale value. This story's AC #8 uses the corrected value (`lg` = 1024, integer literal `1024` for the non-CSS Playwright consumer per AD-21's own instruction: *"Non-CSS consumers use the literals `1024` / `768`"* — 1024 is the one that matters here). `/quiz/[id]` has no structural breakpoint at all (Story 3.3, confirmed) — do not write a responsive-collapse assertion for that route; `full-quiz.spec.ts`'s mobile-project run only needs to prove the quiz-taking flow still works at a narrow width, not that it changes layout.

### LLM-avoidance strategy — specific, not hand-waved

Quiz generation is the one genuinely expensive, slow (5–30s), and non-deterministic LLM surface in the app. This story avoids it entirely for the CI-gating specs, using three distinct techniques for three distinct surfaces:

1. **Quiz generation (`full-quiz.spec.ts`, the mobile project) — DB-seeded fixture session, not a live call.** A standalone seed script (Task 3) writes a complete `ready`-status `quiz_sessions` row plus `documents`/`questions`/`answers` directly into the same Postgres the API uses, through the exact RLS-respecting `set_config` pattern `identity.interceptor.ts` uses (AC #13) — never a superuser bypass. This is fast, free, and fully deterministic (fixed content → stable, designed `categoryBreakdown` strengths). The trade-off, stated plainly: this does **not** exercise the real generation LLM call path (ingest → neutralize → chunk → the structured-output call → grounding check → stratified draw) — that is Epic 2's job, already covered by its own Vitest integration suites plus SM-1's manual ≥2-document demo-run criterion. This story's job is the user-facing *journey*, not generation correctness.
2. **`POST /submit` (`full-quiz.spec.ts`) — exercised for real, because it's free.** Submit is pure math (Story 1.2's scoring module) plus a deterministic token-overlap snippet matcher (Story 3.1's `selectDocSnippets`) — **zero LLM/Tavily calls anywhere in the submit path** (AD-15, Story 3.1 AC #14). This suite drives the real UI through answering and submitting, hitting the real `SubmitAnswersUseCase`, so `categoryBreakdown`/`insights` in the assertions are genuinely computed by production code against the seeded fixture data, not hand-faked.
3. **Landing page start flow (`landing.spec.ts`) — Playwright network interception.** `page.route('**/api/sessions', …)` returns a fast canned `{id, status:'ready'}`. This spec's own AC (epics.md) only scopes it to "URL entry, provider dropdown, strategy selection, and start" — proving the request fires and the router reacts, not proving generation completes. `GET /api/config/providers` is left un-mocked (cheap, LLM-free) so this spec also guards Story 2.3's endpoint.
4. **Chat (`chat.spec.ts`) — one deliberate, scoped, skippable live call.** Chat's value (a grounded, on-topic reply) genuinely cannot be verified without invoking the real LLM at least once, and it's the cheapest possible LLM surface in the app (a single short turn, no retry budget, no pool). This suite makes exactly one such call, with loose structural assertions (never exact wording), a generous timeout, and an automatic `test.skip` when no provider key is present in the environment (so a fork PR or a key-less local run doesn't hard-fail). If CI cost/flakiness on this one test ever becomes a real problem, the documented fallback is a test-double bound behind `LlmPort` at the `apps/api` composition root — deliberately **not** built here (see Scope Boundary) because it's new production-code wiring, arguably crosses `project-context.md`'s "stop and ask before… adding a new provider" line, and isn't needed to make today's suite runnable.

No "tagged live-run project" for full generation was built — DB seeding already covers the deterministic-suite need, and adding a second, separately-gated live-generation project would duplicate SM-1's manual demo-run criterion without a clear owner for its cost/flake budget. Noted as a valid future enhancement, not required here (see Open Questions).

### `data-testid` reference — reuse, don't re-derive

Story 4.3 already pins an exact naming table for the chat panel (`chat-panel`, `chat-thread`, `chat-message`, `chat-message-retry`, `chat-view-older`, `chat-quick-action-study-next`, `chat-quick-action-weakest`, `chat-input`, `chat-send`, `chat-typing-indicator`, `chat-rate-limited`, `explain-question-{n}`). `ResultPage`'s POM methods must use these exact strings. Landing/quiz page component stories (2.7, 3.3) require `data-testid` on every interactive element but do not pin an exact string table — coordinate the precise values against the actually-implemented components at dev time; this story's POM is written against reasonable, self-documenting names (`url-input`, `strategy-picker-{value}`, `provider-select`, `model-select`, `question-count-select`, `start-button`, `answer-option-{position}`, `next-button`, `submit-button`, `position-indicator`, `shortfall-note`) as a proposal, not a guarantee — same convention 3.2/3.3/4.3 used for each other's not-yet-pinned contracts.

### CI script state today (verify before editing)

Root `package.json`'s `test:e2e` is currently `echo 'test:e2e: deferred to Story 5.2 (Playwright)' && exit 0` (Story 1.1). `apps/web/package.json`'s `test:e2e` is currently `echo 'test:e2e: scaffold-only; Playwright lands in Story 5.2' && exit 0`. `packages/eslint-plugin-local/src/index.js` is currently `{ meta: {...}, rules: {} }` — an empty harness, exactly as Story 1.1 left it, with an inline comment already naming this story (`require-data-testid → first UI story / Story 5.2`) as the rule's owner. No `.github/workflows/ci.yml` exists yet; only `.github/workflows/keep-warm.yml` (Story 1.6, cron-only) does.

### Project Structure Notes

```
apps/web/
  playwright.config.ts                    NEW
  e2e/
    pages/
      base-page.ts                        NEW
      landing-page.ts                     NEW
      quiz-page.ts                        NEW
      result-page.ts                      NEW
    fixtures/
      fixture-doc.md                      NEW
      question-pool.ts                    NEW
      seed-session.ts                     NEW
      viewports.ts                        NEW
    tests/
      landing.spec.ts                     NEW
      full-quiz.spec.ts                   NEW
      chat.spec.ts                        NEW
  package.json                            UPDATE (add @playwright/test; real test:e2e script)
package.json                              UPDATE (real test:e2e script)
packages/eslint-plugin-local/
  src/                                    UPDATE — add require-data-testid rule + fixtures + RuleTester spec
eslint.config.js                          UPDATE — wire the new rule, scoped to apps/web/**/*.tsx
.github/workflows/ci.yml                  NEW
```

Do **not** create `apps/web/e2e/pages/history-page.ts` or `chat-page.ts` — epics.md names exactly four POM classes; chat locators live on `ResultPage`, and the history sidebar (owned by unwritten Story 5.1) gets, at most, provisional best-effort locators on `LandingPage` per Task 8. Do **not** create or edit `README.md` or `security.spec.ts` — Story 5.3.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2: Playwright POM + happy-path E2E] — the binding ACs (breakpoint value corrected per Dev Notes)
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 5: Revisit history on any device] — epic framing, FR-8/NFR-4 closure
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements → Shared UI conventions] — `lg` = 1024px correction (2026-07-20), non-CSS literal-integer instruction
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#NFR-4 · 10.4, #SM-3] — Playwright/POM discipline, `getByTestId` only, gap-analysis/insights test-result side-channel
- [Source: .../ARCHITECTURE-SPINE.md#AD-N10 — Testing discipline] — POM location, selector discipline, run order, coverage floors, gap-analysis reporter hook
- [Source: .../ARCHITECTURE-SPINE.md#AD-21 — Single structural breakpoint, AMENDED 2026-07-20] — `lg`/1024 authoritative value, literal-integer instruction for Playwright
- [Source: .../ARCHITECTURE-SPINE.md#Stack] — Playwright 1.61.1 pin
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md]
- [Source: _bmad-output/project-context.md#Testing Rules, #Tooling Rules] — Playwright + POM, `@ai-quiz/require-data-testid` sequencing
- [Source: AGENTS.md#Testing discipline, #Stop and ask before] — provider-list change guardrail this story's LLM-avoidance design deliberately avoids triggering
- [Source: _bmad-output/implementation-artifacts/1-1-monorepo-scaffold-and-tooling-gate.md] — `apps/web/e2e/{pages,fixtures,tests}` scaffold, `test:e2e` stub text, eslint-plugin-local harness, scope-boundary table assigning `require-data-testid` to Story 5.2
- [Source: _bmad-output/implementation-artifacts/1-4-per-session-ownership-walking-skeleton-sessions-endpoint.md] — `RuleTester` fixture pattern for custom ESLint rules; `set_config` RLS pattern the seed script reuses
- [Source: _bmad-output/implementation-artifacts/3-1-submit-score-and-serve-results.md] — authoritative `SubmitRequestSchema`/`SubmitResponseSchema`/`QuestionResultSchema`/`InsightsSchema`; the `selected`-field gap
- [Source: _bmad-output/implementation-artifacts/3-2-result-page-dual-panel-shell-results-panel.md] — single-mount `Tabs.forceMount` pattern this story's AC #6 regression-tests; stale `strengthByCategory` working-assumption text
- [Source: _bmad-output/implementation-artifacts/3-3-quiz-taking-ui-one-question-at-a-time.md] — independently reconstructed submit request/response shape (agrees with 3.1); `/quiz/[id]` no-breakpoint confirmation
- [Source: _bmad-output/implementation-artifacts/2-7-landing-page-and-quiz-start-flow.md] — landing form field set, `data-testid` deferral to this story
- [Source: _bmad-output/implementation-artifacts/4-3-chat-panel-ui-mounted-into-the-result-page-shell.md] — exact `data-testid` naming table for the chat panel; the breakpoint-conflict trail; the stale "lint rule already enforcing this" line
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/EXPERIENCE.md#Responsive & Platform, #Information Architecture] — `lg` = 1024px as the only structural boundary; history sidebar `lg`+/slide-out `<lg`

### Open questions / spec gaps (non-blocking — flagged for the human)

1. **`QuestionResultSchema` omits `selected`.** Story 3.1's schema, as literally authored, cannot support Story 3.2's "user's own selection marked" AC. This suite deliberately does not test for it (see Submit contract reconciliation §4). Decide whether to amend 3.1's schema before 3.2 ships; if amended, add the assertion here as a small follow-up.
2. **Story 3.2's Dev Notes prose for `insights.strengthByCategory` is stale** relative to 3.1's resolved `Record<string, ...>` shape (§3 above) — a documentation-only fix, zero functional impact since 3.2's actual component code never reads that field.
3. **Story 4.3's Dev Notes claims the `require-data-testid` rule "should already be enforcing this"** — inconsistent with the Story 1.1/2.7/3.2/3.3 consensus that this story owns the enforcing rule. Doesn't block this story; flag for whoever next edits 4.3.
4. **Story 5.1 has no story file yet.** This story's mobile-project sidebar/slide-out assertion is provisional (Task 8) against a dependency that doesn't exist. If 5.1 lands with different `data-testid` names than assumed, reconcile there — the same pattern 4.3 used for its then-unwritten dependencies on 3.2/4.1.
5. **No automated "real generation" coverage exists in this suite by design** (see LLM-avoidance strategy). SM-1's ≥2-document demo-run criterion remains a manual/operator-run check, not something `pnpm verify` gates on. If a future story wants an automated, cost-bounded live-generation check, it should be a separately tagged, non-gating Playwright project — not folded into this story's default run.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
