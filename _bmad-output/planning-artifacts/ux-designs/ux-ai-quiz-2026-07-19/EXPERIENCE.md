---
name: ai-quiz
description: Information architecture, behavior, states, interactions, and journeys for ai-quiz. Peer contract to DESIGN.md — this file owns how it works; DESIGN.md owns how it looks.
status: final
updated: 2026-07-19
sources:
  - _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/specs/architecture-spec.md
  - _bmad-output/planning-artifacts/epics.md
---

> **Contract.** This file and `DESIGN.md` are peers and both **win on conflict** with any mock, wireframe, or import. Visual specs live in DESIGN.md and are referenced here by token as `{path.to.token}`. Where this file and an upstream source disagree, the disagreement is called out explicitly rather than silently resolved.

## Foundation

**Form factor:** responsive web only. No native app. **Mobile is a first-class surface, not a degraded desktop** — per PRD OQ-2 (resolved), there is **no "best on desktop" notice** anywhere in the product.

**UI system:** shadcn/ui on Next.js 15 (App Router) + Tailwind 4.3.3. Both spines inherit from it. DESIGN.md specifies the visual delta; this file specifies only the **behavioral** delta on top of shadcn/Radix defaults — which already supply correct roles, focus management, and keyboard handling for the primitives in use (`RadioGroup`, `Checkbox`, `Select`, `Tabs`, `Sheet`, `Dialog`).

**Motion:** `motion` 12.42.2, imported from `motion/react`.

**Client state:** TanStack Query v5 for all server state; React Context for exactly two things (UUID identity, theme); `useState` per component; `useLocalStorage` for persisted prefs. No Zustand, no Redux. The anonymous UUID is generated in an inline `<head>` script **before React hydrates** — so no surface may render an identity-dependent state that could flash or mismatch on first paint.

**Identity:** anonymous UUID v4 in localStorage, sent as `X-User-Id`. There is **no auth, no login, no account surface, and no logout**. A consequence the UX must own honestly: _history is bound to this browser and is lost if site data is cleared._ See **Trust & Disclosure**.

## Information Architecture

Three routes. Every surface below traces to a story; nothing here is invented without being marked.

| Route          | Purpose                              | Stories  |
| -------------- | ------------------------------------ | -------- |
| `/`            | Start a session; revisit past ones   | 2.5, 5.1 |
| `/quiz/[id]`   | Answer questions, one at a time      | 3.3      |
| `/result/[id]` | Score, breakdown, insights, and chat | 3.2, 4.3 |

**`/` — Landing**

- Session form: URL input · `topic` hint (optional, ≤200 chars) · strategy picker (required, 4 options, **no default**) · provider select → model select (**dependent**) · `questionCount` (5–8, default 8) · Start
- History sidebar (`lg`+) / slide-out sheet (`< lg`): session list, load-more, empty state

**`/quiz/[id]` — Quiz runner**

- Progress indicator · question card (text, 4 options, single- or multi-select) · Previous / Next · Submit on the final question
- Single column at every width. **No chat surface.** Categories are **hidden here** and revealed only at results.

**`/result/[id]` — Result**

- Left / "Results" tab: score reveal · category strength chips · per-question breakdown with "Explain Qn" · insight narrative and `topicsToStudy`
- Right / "Chat" tab: persistent thread · "view older" · message input
- Insights render **inline**. There is no "Analyze gaps" trigger and no insight endpoint (FR-12/FR-13 removed 2026-07-19).

**Surface closure.** Every stated need lands somewhere: _start a session_ → `/`; _answer_ → `/quiz/[id]`; _see how I did_ → `/result/[id]` results panel; _ask follow-ups_ → chat panel (UJ-2); _find my gaps_ → chat + inline insights (UJ-4); _come back later_ → history (UJ-3). No orphan surfaces; no need without a surface.

**Chat exists only on `/result/[id]`.** Not on landing, not on the quiz. This is a deliberate decision (memlog #9), and it resolves a real problem: the architecture's AD-12 guard redacts question text from chat context while a session is `ready`, which would produce a strangely useless assistant mid-quiz. Because a `ready` session routes to `/quiz/[id]`, which has no chat, **that state is unreachable through the UI**. The server-side redaction remains as defense-in-depth. This file specs no pre-submit chat state, because none exists.

## Voice and Tone

The assistant is a **capable study partner, not an examiner**. It knows the document, it is candid about what you missed, and it never performs either enthusiasm or disappointment.

| Do                                                                                | Don't                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------ |
| "You scored 1.5/4 on WebSockets. §3.2 covers retry semantics — worth re-reading." | "Oops! Looks like WebSockets tripped you up! 😅" |
| "This document supported 6 questions."                                            | "We could only manage 6 questions."              |
| "That URL points to a private network address, so it can't be fetched."           | "Error: SSRF_BLOCKED"                            |
| Name the remedy                                                                   | Name the blame                                   |

Rules: second person, present tense. No exclamation marks. No emoji. No gamification language (streaks, points, levels, "crushed it"). Never congratulate a high score or commiserate a low one — **state it and move to what's next**. Errors describe what happened and what to do, never what the user did wrong. Numbers are stated plainly, never editorialized.

## Component Patterns

Behavioral contracts only — visual specs live in `DESIGN.md`.

**Answer option.** Renders `{components.answer-option}`. `single` → radio semantics, exactly one selection, picking another replaces it. `multiple` → checkbox semantics, **2–4 correct exist but the user may select any number**; the UI must never hint how many are correct. Exactly 4 options at positions 0–3, always in server order — never shuffled client-side, or per-question breakdown positions stop matching. Entire option row is the hit target, label included.

**Question text and answer text render as plain text — never markdown, never HTML.** `{text}` auto-escaping is a security control (AD-N1), not a styling choice. **DOMPurify is scoped to explanations and chat only**, via the single `lib/sanitize.ts` wrapper; sanitized links get `rel="noopener noreferrer"` with `target="_blank"`.

**Strength chip.** Renders `{components.strength-chip}`. Always carries its literal label — `strong` / `mixed` / `weak`. Rendered only for categories with ≥1 question; an empty category is never shown.

**Score display.** `{typography.score}`, animated count-up (see **Interaction Primitives**). Neutral ink, never a strength color.

**"Explain Qn" control.** Client-side only. Pre-fills the chat input with `Explain question {n} — I answered {correctly|incorrectly}: {selection}`, moves focus to the input, and places the caret at the end so the text is immediately editable. **Nothing is sent.** No `questionId` reaches the server; chat is fully decoupled from questions. On `< lg`, it switches to the Chat tab first, then fills and focuses.

**Chat thread.** Latest 50 messages; **"view older"** loads the previous batch on demand and **preserves scroll position** — the newly loaded batch must not yank the viewport. Messages carrying `tool_calls` show a tool-call badge; `sources` render as a compact list beneath the message. `thinking` (MiniMax `reasoning_details`) is present in the payload and **is not rendered in v1** `[ASSUMPTION]`.

**Provider → model select.** Model options depend on the chosen provider. Changing provider resets model to that provider's default. If `GET /api/config/providers` returns `[]`, see **State Patterns → No providers configured**.

**Strategy picker.** Four options — `factual` · `comprehension` · `mixed` · `trivia`. **Required, with no pre-selection**; the form cannot be submitted until one is chosen. This is a security property (free-text strategy is a prompt-injection vector), so the UI must not "helpfully" default it.

## State Patterns

### The long wait — narrated stages

Two operations block the user on an LLM round trip: **generation** at `POST /api/sessions` (5–30s) and **submission** at `POST /api/sessions/:id/submit`, which computes insights synchronously. Both get the same treatment.

**There is no polling.** Generation is sync HTTP and stays that way; the architecture's reserved `status='pending'` + 202 escape hatch is **not adopted**. Narration is **purely client-side and time-driven** — it makes no server round trip and reports no real progress.

Generation narration, advancing on a client timer:

| Elapsed | Copy                                                        |
| ------- | ----------------------------------------------------------- |
| 0s      | Fetching the document…                                      |
| ~3s     | Reading it through…                                         |
| ~8s     | Writing your questions…                                     |
| ~20s    | Almost there — longer documents take a little more thought. |

Submission narration: `Scoring your answers…` → ~4s → `Working out where the gaps are…`

Rules: stages **only advance forward**, never loop or reset — a looping animation is what makes a wait read as hung. The final stage is honest about the overrun rather than pretending. **No determinate progress bar** anywhere: the system cannot know progress, and a bar stalled at 90% costs more trust than an honest indeterminate wait. Start is disabled and the form is locked while in flight, preventing a duplicate `POST /sessions` against a 5/min limit.

`prefers-reduced-motion` swaps any accompanying animation for static text; the stage copy itself still advances, because it is information, not decoration.

### Per-surface states

**`/` Landing**

- _Idle_ — form empty, Start disabled until URL and strategy are both valid
- _No providers configured_ — `GET /api/config/providers` returned `[]`. Explanatory message, **Start disabled**. Explicitly never an empty dropdown behind a live button
- _Submitting_ — narrated stages, form locked
- _Generation failed_ — inline error with a **Retry** button. **Never an infinite spinner** (UJ-1). Retry re-submits the same form values, which are preserved
- _Validation errors_ — see the error table below

**History sidebar**

- _Empty_ — first-time user, zero sessions. An explicit empty state, never a blank panel
- _Loading_ — skeleton rows
- _Populated_ — source URL, status, created date per row; capped page size with **load-more**
- _Row by status:_ `submitted` → `/result/[id]` · `ready` or `pending` → resume at `/quiz/[id]` · `failed` → non-navigating row with an error indicator and a **retry affordance** that starts a fresh session from the same URL

**`/quiz/[id]`**

- _Loading_ — question-card skeleton `[ASSUMPTION]`
- _Ready_ — question rendered; Next/Submit **gated on ≥1 selected option** (the API rejects an empty `selected[]` with 400, so the UI must never allow it)
- _Not found / not owned_ — 404 renders "This session isn't available." Cross-user and nonexistent are **indistinguishable by design**; the copy must not hint that the session exists
- _Fewer questions than requested_ — `actualCount` present: a quiet inline note at the top of the first question (see **Trust & Disclosure**)
- _Already submitted_ — redirect to `/result/[id]`
- _Error_ — retry affordance, answers preserved in component state `[ASSUMPTION]`

**`/result/[id]`**

- _Loading_ — skeleton for score, chips, and breakdown `[ASSUMPTION]`
- _Loaded_ — score count-up, chips, breakdown, inline insights
- _Chat slot empty_ — pre-Epic-4 shell contract (story 3.2)
- _409 on submit_ — session was `pending` or `failed`; surface the returned status and route back appropriately
- _Duplicate submit_ — returns 200 with the cached result. **Never 5xx**; retry is always safe

**Chat panel**

- _Empty_ — seeded with a brief system message framing what can be asked, plus quick-action chips ("What should I study next?", "Explain Q1") `[ASSUMPTION]`
- _Sending_ — user message appears immediately; assistant slot shows a typing indicator. Input stays enabled but **send is disabled until the response lands** — chat is sync HTTP with no streaming, and concurrent sends against a 20/min limit are a real risk `[ASSUMPTION]`
- _Error_ — failed message stays in the thread with a retry affordance; the drafted text is **never lost** `[ASSUMPTION]`
- _Rate limited_ — see below

### Error copy

All failures return `{error: {code, message, requestId}}` with no stack trace. The UI shows human copy, never a raw code; `requestId` is available but de-emphasized.

| Code                      | User-facing copy                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DOC_TOO_LARGE` (size)    | This document is too large to process. Try a more focused page.                                                        |
| `DOC_TOO_LARGE` (context) | This document is longer than the selected model can read. **Switch provider or model** — MiniMax-M3 handles 1M tokens. |
| `DOC_TOO_SHORT`           | This document is short — there's enough here for about {n} questions. **Reduce the question count** to continue.       |
| SSRF blocked              | That URL can't be fetched — it points to a private or restricted address.                                              |
| 400 invalid URL           | That doesn't look like a public document URL. It should start with `http://` or `https://`.                            |
| 429                       | You're going a bit fast. Try again in {Retry-After} seconds.                                                           |
| 404                       | This session isn't available.                                                                                          |
| 409                       | This session isn't ready to submit yet.                                                                                |
| Generation failed         | We couldn't build a quiz from this document. **[Retry]**                                                               |

Each hint names the **form field to change** and, where possible, focuses it. `DOC_TOO_SHORT` and the context-overflow variant are recoverable in place — the user must never have to retype the URL.

> `[NOTE FOR UX]` The architecture spec §A.7 step 7 emits `DOC_TOO_SHORT` when fewer than 2 distinct categories are found, but AD-N4 states that code is "owned solely by AD-N3 (pre-LLM doc sizing), never emitted from here." **Unreconciled upstream.** If §A.7 wins, the copy above is wrong for that path — it would tell the user to reduce `questionCount` when the real cause is a document with too little topical variety. Needs an architecture decision before story 2.2.

## Interaction Primitives

**Navigation.** Start → `/quiz/[id]` on `status='ready'`. Submit → `/result/[id]` on success. History row → by status, as above. Browser back from `/result/[id]` must not re-submit.

**Quiz navigation.** One question per screen, Previous/Next, position tracker ("3 of 8"). Previous is enabled from question 2; Next becomes Submit on the last. Answers persist across Previous/Next within the session. **The server is authoritative** — client gating is a courtesy, not the control.

**Motion.** Inherited from architecture §A.11, tuned to the calm posture: page fade + slide on route change; question card transition on advance; **score count-up** (~800ms, easing out — the one genuinely expressive moment in the product); chat panel slide-in; strength-chip color transition on mount.

Motion is _confirmation_, never _decoration_. The score count-up earns its place because it gives the number a beat to land. Nothing celebrates. The architecture's "hover pulse" on strength chips is **dropped** — a pulsing weak-category chip draws anxious attention to exactly the thing this product is trying to make safe to look at. `[Override of §A.11]`

**`prefers-reduced-motion: reduce`** replaces every transition with an instant state change, including the count-up (final value renders immediately). Nothing is lost but the animation.

**Focus.** On route change, focus moves to the new surface's `<h1>`. On question advance, focus moves to the question text. On "Explain Qn", focus moves to the chat input. On error, focus moves to the error message. On sheet/dialog open, focus is trapped and returns to the trigger on close (Radix default).

**Keyboard.** Every interactive element is reachable and operable. Answer options are arrow-key navigable within their group (radio) or individually tabbable (checkbox) — Radix defaults. `Enter` submits the landing form when valid. In chat, `Enter` sends and `Shift+Enter` inserts a newline `[ASSUMPTION]`.

**Touch.** Minimum 44px targets — answer options are 48px. No hover-dependent affordances anywhere.

## Accessibility Floor

**WCAG 2.2 AA is binding and testable.**

- **Contrast** — every pairing verified by computation, documented in `DESIGN.md § Colors`. Body text ≥4.5:1; UI components and large text ≥3:1
- **Never color alone** — strength chips carry text labels; selection is conveyed by border _weight_ plus color; correct/incorrect in the breakdown carries an icon and text, not just a hue
- **Keyboard** — full operability, no traps, visible 2px `{components.focus-ring}` on every focusable element
- **Targets** — ≥24px per AA; the product ships 44px+ throughout
- **Semantics** — one `<h1>` per surface, ordered headings, `<fieldset>`/`<legend>` per question group, labelled form controls, `aria-describedby` linking inputs to their errors
- **Live regions** — narration stages, chat arrivals, and errors announce via `aria-live="polite"`; the stage narrator must not spam (one announcement per stage change)
- **Motion** — `prefers-reduced-motion` honored everywhere
- **Zoom** — usable at 200% without horizontal scrolling
- **Language** — `lang="en"`. UI is English-only by design (i18n explicitly out of scope)

`data-testid` on every interactive element is **testability, not accessibility** — enforced by the `@ai-quiz/require-data-testid` lint rule and consumed by Playwright's `getByTestId()`. It satisfies no requirement in this section.

## Trust & Disclosure

The product's pitch is trustworthiness; these are the moments where that is won or lost.

**Question shortfall.** When `actualCount < questionCount`, the user **is told**, with a remedy and without blame:

> This document supported **6** questions rather than 8 — try a longer document if you'd like the full set.

Framed as a property of the document, never as user error or system failure. Shown once, inline, quietly. The system **never pads with filler** to hide the shortfall.

**Anonymous history.** History is bound to this browser via a locally stored ID. Stated once on the history empty state — plainly, not as a warning:

> Sessions are saved to this browser. There's no account to sign in to.

**Security refusals are features.** When a URL is refused, the copy explains the reason (private address, restricted scheme) rather than emitting a code. A user probing the system should _see it working_, per JTBD 3.

**No fabricated confidence.** Never show a determinate progress bar over an indeterminate wait; never imply the assistant has knowledge beyond the source document.

## Responsive & Platform

| Breakpoint   | Landing                                    | Quiz                    | Result                                   |
| ------------ | ------------------------------------------ | ----------------------- | ---------------------------------------- |
| `< 640px`    | Stacked form; history in a slide-out sheet | Single column           | **Tabs:** Results / Chat                 |
| `640–1023px` | Stacked, full width; history sheet         | Single column           | Tabs                                     |
| `≥ 1024px`   | Two-pane: form + history sidebar           | Single column, centered | Dual panel — results scroll, chat sticky |

The `lg` (1024px) boundary is the only structural one. `/quiz/[id]` never changes structure — it is one card in a reading measure at every width.

**Mobile specifics.** The chat input must clear the on-screen keyboard and stay visible while typing. The Results/Chat tab control is sticky. "Explain Qn" switches tabs before focusing the input. The history sheet is dismissible by swipe and by `Escape`.

## Key Flows

Protagonist and journey names mirror the PRD verbatim.

### UJ-1. Sam runs the canonical happy path

Sam is evaluating pipecat for a project. He's skimmed the README once and wants to know whether he actually took any of it in.

1. Lands on `/`. Pastes the pipecat README raw URL.
2. Picks strategy `mixed` — nothing is pre-selected, so this is a deliberate choice. Leaves `questionCount` at 8, provider at MiniMax-M3.
3. Clicks **Start**. The form locks and narration begins: _Fetching the document… Reading it through… Writing your questions…_ Sam watches it move. It takes 19 seconds and never once looks stuck.
4. Lands on `/quiz/[id]`, question 1 of 8. Answers each; Next stays disabled until he's picked something. Two questions are multi-select and he can't tell how many are correct — which is the point.
5. Submits on question 8. _Scoring your answers… Working out where the gaps are…_
6. **Climax.** `/result/[id]`. The score counts up to **2.8**. Below it, category chips: `Transports — strong`, `Pipelines — mixed`, `Streaming — weak`. The weak chip is warm clay, the same visual weight as the others. Sam reads it as a fact about what to do next, not a mark against him.
7. Opens chat and types "Why am I weak in Streaming?" A pause, then an answer citing the actual doc section.
8. Reruns on the langchain README. Both sessions now sit in the history sidebar.

_Edge:_ if generation fails, Sam sees an error and a **Retry** button — never an endless spinner.

### UJ-2. Sam asks follow-up questions via chat (free text, decoupled from questions)

1. On `/result/[id]` with the chat panel open.
2. Types freely: "Can you explain the WebSocket transport section in more detail?" The assistant answers from the document, with sources listed beneath.
3. Scanning his breakdown, he hits question 3 and clicks **Explain Q3**. The chat input fills with `Explain question 3 — I answered incorrectly: Option B`, focus lands in the field, caret at the end. **Nothing has been sent.**
4. He edits it to add "…and what should I have looked for?" then sends. The question reference travels as plain text; no anchor reaches the server.

### UJ-3. Sam revisits an old session from history (mobile-friendly)

A week later, on his phone.

1. Opens `/` on mobile. The history sidebar is a slide-out; he taps to open it.
2. Sessions listed by URL, status, and date. Taps the pipecat one.
3. Loads `/result/[id]` as **tabs** — Results and Chat. His score, chips, and breakdown are exactly as he left them; the chat thread is restored from the database.
4. Switches to Chat, scrolls up, taps **view older**. The earlier batch loads and his scroll position holds.

_Edge:_ a session left `ready` from a crashed attempt resumes at `/quiz/[id]` instead — status was preserved server-side. A `failed` session doesn't navigate; it offers retry.

### UJ-4. Sam analyzes gaps via chat (no separate insight endpoint)

1. On `/result/[id]`, insights are **already rendered inline**. There is no "Analyze gaps" button, because there is no insight endpoint.
2. Sam types "What should I study next?"
3. The assistant answers from the precomputed `topicsToStudy[]`: _"You scored 1.5/4 on WebSockets; the doc section §3.2 covers retry semantics — re-read that."_
4. He asks a follow-up. The thread persists; it'll be here next week.

> `[NOTE FOR UX]` **Blocking upstream gap.** `topicsToStudy[]` has no defined element type or derivation rule (architecture Deferred item N8) beyond "computed at submit." This flow and the inline insight rendering both depend on its shape. It must be pinned in `packages/shared/src/schemas.ts` **before story 4.1** — until then, the inline insight display cannot be built to a contract.

## Open Items

| #   | Item                                                                             | Owner             | Blocks                     |
| --- | -------------------------------------------------------------------------------- | ----------------- | -------------------------- |
| 1   | `topicsToStudy[]` element type undefined (Deferred N8)                           | Architecture      | Story 4.1, inline insights |
| 2   | `DOC_TOO_SHORT` for <2 categories — §A.7 vs AD-N4 conflict                       | Architecture      | Story 2.2 error copy       |
| 3   | Wire-projection ownership for `questions` — `ready` vs `submitted` (Deferred N6) | Architecture      | Result view                |
| 4   | End-to-end sync latency budget unowned; worst-case retries may breach ~30s       | Architecture      | Narration's final stage    |
| 5   | `thinking` (`reasoning_details`) — not rendered in v1                            | UX `[ASSUMPTION]` | Story 4.3                  |
| 6   | Chat empty-state seed copy and quick-action chip set                             | UX `[ASSUMPTION]` | Story 4.3                  |

**Note on #4:** the agreed remedy if p95 breaches the ceiling is **cutting the retry budget**, not introducing polling. Polling is out of scope for v1 by decision.
