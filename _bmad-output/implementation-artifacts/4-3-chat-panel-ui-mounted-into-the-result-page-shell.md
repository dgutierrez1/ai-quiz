# Story 4.3: Chat panel UI (mounted into the result-page shell)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a chat panel on my result page,
so that I can ask questions and get study guidance conversationally.

## Acceptance Criteria

_(FR-10 UI, UJ-2, UJ-4; UX: DESIGN.md, EXPERIENCE.md)_

1. **Mount, not rewrite.** Given the Epic 3 result-page shell (Story 3.2, not yet built — see Dev Notes § Chat slot contract), then the chat panel mounts into the existing chat slot as a self-contained `ChatPanel` component; this story does not touch `ResultsPanel`, the score display, `categoryBreakdown`, or the insights narrative.
2. **Thread render.** Given a submitted session, then `ChatPanel` renders the latest 50 messages (oldest→newest) plus a "view older" control and a message input, and every interactive element carries `data-testid`.
3. **Empty state.** Given a session with zero chat messages, then the panel shows a brief framing line plus two quick-action chips ("What should I study next?" and "Where am I weakest?") that send immediately on click — see Dev Notes for why these two and not a per-question chip.
4. **Sending state.** Given the user submits a message, then it appends optimistically to the thread in a "sending" visual state, the input clears, and the send control is disabled until the response lands (no streaming; sync HTTP) — the assistant slot shows a typing indicator (static "Thinking…" text under `prefers-reduced-motion`).
5. **Error state.** Given `POST /sessions/:id/chat` fails (network error, 5xx, or 429), then the optimistic user message flips to an error visual state with an inline **Retry** (resends the identical content) — the drafted text is never silently discarded. A 429 shows "You're going a bit fast. Try again in {n} seconds." per EXPERIENCE.md's error-copy table.
6. **Tombstoned messages.** Given a message whose `content` is `null` (Story 4.4's 7-day scrub), then it renders a neutral placeholder ("This message was removed after 7 days.") using the retained `role` + `created_at`, never an error or a blank gap.
7. **"Explain Qn" control.** Given the `ExplainQuestionButton` rendered by Story 3.2 inside its per-question breakdown, when clicked, then it pre-fills the chat input with `Explain question {n} — I answered {correctly|incorrectly}: {selection}` purely client-side (no request sent), moves focus to the input with the caret at the end, and — on a viewport narrower than the shared structural breakpoint — switches to the Chat tab first. No `questionId` or any anchor field is ever sent to the server; the reference lives only in the message text.
8. **Gap analysis, no extra call.** Given the message "What should I study next?" (typed or via quick-action chip), then the assistant's answer is grounded in `insights.topicsToStudy` already loaded into the chat LLM's context at session start (Story 4.1) — the client makes no separate insight request; there is no insight endpoint.
9. **Sanitization split (two different rules, both security controls).** Given assistant message content, then it is rendered through `apps/web/lib/sanitize.ts` (markdown → HTML → DOMPurify, config in Dev Notes) with `rel="noopener noreferrer"` forced onto every `target="_blank"` anchor. Given question or answer text anywhere on the page (owned by Story 3.2 / 3.3, not this story), then it renders as auto-escaped plain text — this story must not introduce a code path that could let DOMPurify or `dangerouslySetInnerHTML` touch question/answer text.
10. **`thinking` is present but never rendered.** Given a message with a non-null `thinking` payload (MiniMax `reasoning_details`), then the client renders no UI for it in v1 (EXPERIENCE.md Open Item #5) — the field is fetched and typed but intentionally unused.
11. **Tool calls and sources.** Given a message with non-null `toolCalls`, then a compact tool-call badge renders on that message. Given non-null `sources`, then they render as a compact list beneath the message.
12. **Responsive.** Given a viewport narrower than the shared structural breakpoint, then chat is reachable via the Chat tab (owned by Story 3.2's shell) and the input stays visible above the on-screen keyboard. **The literal breakpoint value is disputed — see Dev Notes § Breakpoint conflict and Open Questions; this story consumes whatever token 3.2 defines and does not redeclare it.**
13. **Keyboard & live region.** Given the chat input, then `Enter` sends (when non-empty and not currently sending) and `Shift+Enter` inserts a newline. Given the thread container, then it exposes `role="log"` + `aria-live="polite"` + `aria-relevant="additions"` so incoming assistant turns are announced without re-announcing scrollback on mount or "view older."
14. **`data-testid` coverage.** Given every interactive element in the chat panel (input, send button, view-older button, quick-action chips, retry button, explain-question buttons), then it carries `data-testid` per the naming scheme in Dev Notes; tests use `getByTestId(...)` only.

## Tasks / Subtasks

- [ ] **Task 1 — Define the chat slot contract** (AC: #1, #7, #12)
  - [ ] Write `ChatPanelProps` and `ExplainQuestionButtonProps` exactly as specified in Dev Notes § Chat slot contract. These are the interface Story 3.2 must mount against — Story 3.2 does not exist yet, so treat this as the provisional contract and record it as such.
  - [ ] Do **not** add a third React Context for the "Explain Qn → prefill chat input" communication — AD-17 caps Context usage at exactly two (UUID, theme). The prefill value and its consumption callback are **lifted state owned by Story 3.2's parent shell**, passed down as props to both `ExplainQuestionButton` (via `onExplain`) and `ChatPanel` (via `pendingPrefill` / `onPrefillConsumed`).
- [ ] **Task 2 — `lib/sanitize.ts` (first story to need it)** (AC: #9)
  - [ ] Add `dompurify@3.4.12` + `@types/dompurify@3.2.0` + `marked` (markdown→HTML step — see Dev Notes § Markdown gap) to `apps/web/package.json`.
  - [ ] Implement `sanitizeChatHtml(markdown: string): string` per the exact config in Dev Notes. Guard against SSR (`typeof window === 'undefined'` → return `''`; DOMPurify requires a live DOM and this file must never be evaluated during Next.js's server render pass for a `'use client'` component's initial HTML).
  - [ ] Add the `afterSanitizeAttributes` hook forcing `rel="noopener noreferrer"` on every anchor carrying `target="_blank"`.
  - [ ] Export a second function, `sanitizeExplanationHtml`, sharing the same config — **Story 3.2 must import this for rendering `questions.explanation`**, not fork a duplicate DOMPurify call. Document this handback in the file's module comment.
- [ ] **Task 3 — Chat data layer** (AC: #2, #4, #5, #8)
  - [ ] Extend `apps/web/lib/queries.ts`'s query-keys factory: `queryKeys.sessions.chat(sessionId)`.
  - [ ] `useChatHistoryQuery(sessionId)` → `GET /api/sessions/:id/chat` (latest 50, no `limit`/`offset` params — see Dev Notes § Chat API contract, provisional pending Story 4.1).
  - [ ] `useLoadOlderChatMutation(sessionId, beforeCursor)` → same endpoint with a `before` cursor query param (oldest currently-loaded message's `createdAt`), **not** `offset`.
  - [ ] `useSendChatMessageMutation(sessionId)` → `POST /api/sessions/:id/chat`, optimistic update via TanStack Query's `onMutate`, rollback-to-error-state (not rollback-to-nothing) `onError` per AC #5.
- [ ] **Task 4 — Chat thread rendering** (AC: #2, #6, #10, #11, #13)
  - [ ] `apps/web/components/result/chat-thread.tsx` — `role="log"` container, message list, tombstone placeholder branch, tool-call badge, sources list, "view older" button that preserves scroll position (do not let the newly loaded older batch yank the viewport — anchor scroll to the previously-topmost message).
  - [ ] `apps/web/components/result/chat-message.tsx` — renders one bubble; user messages via `{components.chat-message-user}` (plain text, right-aligned, capped 80% column width); assistant messages via `{components.chat-message-assistant}` (transparent, full width, `sanitizeChatHtml` + `dangerouslySetInnerHTML`) — **never** call `sanitizeChatHtml` on a user message; user content always renders as plain text.
- [ ] **Task 5 — Chat input + empty state + quick actions** (AC: #3, #4, #5, #13, #14)
  - [ ] `apps/web/components/result/chat-input.tsx` — textarea (`maxLength=8000`), Enter/Shift+Enter handling, send button, disabled while a send is in flight.
  - [ ] `apps/web/components/result/chat-empty-state.tsx` — framing copy + two quick-action chips (send immediately on click, per AC #3).
  - [ ] Wire `pendingPrefill` prop: when set, populate the input, focus it, place caret at end, then call `onPrefillConsumed()`.
- [ ] **Task 6 — `ExplainQuestionButton`** (AC: #7)
  - [ ] `apps/web/components/result/explain-question-button.tsx` — computes the exact template string from `questionNumber` + `wasCorrect` + `selectionText` props and calls `onExplain(text)`. This component is **owned and shipped by this story** even though Story 3.2 is the one that mounts one instance per question in its breakdown list.
- [ ] **Task 7 — `ChatPanel` composition + motion** (AC: #1, #12)
  - [ ] `apps/web/components/result/chat-panel.tsx` — composes empty/thread/input states by message count and in-flight status; slide-in mount animation via `motion/react` (per EXPERIENCE.md — the chat-panel slide-in is retained; the strength-chip hover pulse that was dropped belongs to Story 3.2, not this one), respecting `prefers-reduced-motion` (`useReducedMotion()` → skip the slide, mount instantly).
- [ ] **Task 8 — Accessibility pass** (AC: #13, #14)
  - [ ] `role="log"` + `aria-live="polite"` + `aria-relevant="additions"` on the thread container (Task 4).
  - [ ] Visible 2px `{colors.accent}` focus ring, 2px offset, on every focusable element in the panel.
  - [ ] Labelled input (`aria-label` or associated `<label>`), `aria-describedby` linking the input to any inline error/rate-limit banner.
  - [ ] 44px+ touch targets on send button and quick-action chips (input itself is fluid width).
- [ ] **Task 9 — Tests**
  - [ ] Vitest component tests: empty state renders + chips send; sending state disables input and shows optimistic bubble; error state shows retry and preserves content; tombstone renders placeholder for `content: null`; "view older" fetches with a cursor param (not offset); `sanitizeChatHtml` strips a `<script>` payload and forces `rel="noopener noreferrer"` on an injected `target="_blank"` link; Enter sends, Shift+Enter inserts newline; `ExplainQuestionButton` produces the exact template string for both `correctly`/`incorrectly` branches.
  - [ ] Do **not** build `chat.spec.ts` (Playwright) — that is Story 5.2's explicit deliverable ("Given `chat.spec.ts`, Then it covers a post-submit message receiving a grounded response, And the client-side 'Explain Qn' prefill"). This story only needs `data-testid`s in place for it to consume later.
  - [ ] Run `pnpm --filter @ai-quiz/web test` before marking done.

## Dev Notes

### 🚨 Chat slot contract (provisional — Story 3.2 has no story file yet)

Story 3.2 (`Result page: dual-panel shell + results panel`) is the story that owns the mount point this component mounts into. As of this writing it exists only as ACs in `epics.md` (Epic 3) — no context file. This story therefore **defines the contract Story 3.2 must reconcile against**, rather than reading it from an existing sibling file. Whoever authors 3.2 must treat the shapes below as a requirement, not a suggestion, and correct this story's citation if the final shape differs.

**Component boundary.** `ChatPanel` is a fully self-contained component. Story 3.2's shell renders it inside its "chat slot" (today an empty/disabled placeholder per Story 3.2's AC #1) and passes nothing but the props below — it does not reach into `ChatPanel`'s internals, and `ChatPanel` never reaches into the results panel.

```ts
// apps/web/components/result/chat-panel.tsx — owned by this story
interface ChatPanelProps {
  sessionId: string;
  /** Set by Story 3.2's parent shell when an ExplainQuestionButton fires. */
  pendingPrefill?: string | null;
  /** Called once ChatPanel has consumed pendingPrefill into its own input state. */
  onPrefillConsumed?: () => void;
}
```

```ts
// apps/web/components/result/explain-question-button.tsx — owned by this story,
// but MOUNTED by Story 3.2 once per question inside its breakdown list.
interface ExplainQuestionButtonProps {
  questionNumber: number; // 1-based, for the visible label and template text
  wasCorrect: boolean;
  selectionText: string; // human-readable rendering of the user's selected answer(s)
  onExplain: (prefillText: string) => void;
}
```

**What Story 3.2 must own (not this story):**

1. Lifted `pendingPrefill: string | null` state at the shell level, threaded to both `ExplainQuestionButton.onExplain` (sets it) and `ChatPanel.pendingPrefill`/`onPrefillConsumed` (consumes it). This is lifted-state-via-props, **not** a new React Context — AD-17 permits exactly two Contexts (UUID, theme) and a third would violate it.
2. Tab-switch behavior: on a viewport narrower than the structural breakpoint, `onExplain` must also switch the shell's own `activeTab` state to `"chat"` before/alongside setting `pendingPrefill`, per EXPERIENCE.md ("On `< lg`, it switches to the Chat tab first, then fills and focuses").
3. A guard on `/result/[id]` itself: only a `submitted` session's tree may mount `ChatPanel` at all. `ChatPanel` assumes `status === 'submitted'` unconditionally and specs no pre-submit UI state (see § Pre-submit state below) — if 3.2 lets a `ready`/`pending` session reach this component, that assumption breaks. Story 5.1's history routing already sends `ready`/`pending` sessions to `/quiz/[id]`, but a user can still type `/result/[id]` directly for a non-submitted session id; 3.2 must redirect that case (mirroring Story 3.3's reverse redirect for an already-`submitted` session hitting `/quiz/[id]`).

**Why chat specs no pre-submit state.** Chat exists only on `/result/[id]`; a `ready` session routes to `/quiz/[id]`, which has no chat surface at all (EXPERIENCE.md, decision memlog #9). That makes AD-12's pre-submit chat redaction **unreachable through the UI** — the server-side guard (Story 4.1) remains as defense-in-depth, but this story builds no "chat disabled pre-submit" banner, no locked input, nothing. If Story 3.2's guard above is ever missed, the failure mode is a confusing UI (chat appearing to work against a session with no results), not a security hole — the server still returns 409/redacts per Story 4.1.

### ✅ Breakpoint conflict — RESOLVED 2026-07-20: `lg` / 1024 px

> **Resolution (appended after this story was drafted).** The conflict analysed below is closed. `ARCHITECTURE-SPINE.md#AD-21` was **amended on 2026-07-20** — concurrently with this story being written, which is why the analysis below still describes it as un-patched — and now reads: _"Collapse at Tailwind's built-in `lg` token — `--breakpoint-lg`, `64rem` (= 1024 px)... `md` = 768 px remains legal but is NON-STRUCTURAL... A story using `md` for structure is a defect."_ `epics.md`'s per-story AC bullets (3.2, 3.3, 4.3, 5.1, 5.2) were re-synced the same day.
>
> **The structural value is `lg` / 1024 px.** This story needs no change: no component here hardcodes a pixel value, and the `ChatPanel` props contract was deliberately built breakpoint-agnostic. The recommendation recorded below — that 3.2 implement `lg` and AD-21 be patched — is what happened. The analysis is retained below as the audit trail.

### ⚠️ Original conflict analysis (superseded — retained for provenance)

This is the single most consequential open item in this story and it is **more tangled than a simple two-way disagreement** — record all of it, do not silently pick a side.

- **This story is instructed to write against the shared `md` token (768px)**, on the premise that `ARCHITECTURE-SPINE.md#AD-21` is the binding authority over the UX spine documents. AC #12 and the props above are written to be breakpoint-value-agnostic (`ChatPanel` never hardcodes a pixel value; it consumes whatever token 3.2's shell exposes) specifically so this story does not have to bake in a number that later turns out wrong.
- **What was actually found during research, in date order:**
  1. `ARCHITECTURE-SPINE.md#AD-21` (`updated: 2026-07-19`, still current as of this writing) states: _"Collapse at Tailwind's built-in `md` token — `--breakpoint-md`, `48rem` (= 768px)."_
  2. `DESIGN.md` and `EXPERIENCE.md` (both `status: final`, `updated: 2026-07-19`, same day as AD-21) both explicitly say the opposite: _"The `lg` (1024px) boundary is the one that matters — it is where the dual panel collapses to tabs and where the sidebar becomes a sheet."_ `md` in the UX spine governs only non-structural stacking (landing form, history list), never the dual-panel/tabs or sidebar/sheet collapse.
  3. Story 2.7 (already written, predates the epics.md correction below) flagged this exact conflict as an "Unresolved spec gap," noted it doesn't block 2.7 itself, and explicitly said it **must** be resolved before Stories 3.2, 3.3, 4.3, 5.1 ship.
  4. **`epics.md`'s "Shared UI conventions" section was corrected on 2026-07-20 (today)** — after AD-21 and after Story 2.7 were written — to read: _"Structural breakpoint: `lg` = 1024px (corrected 2026-07-20 — was `md` = 768px)... This matches `DESIGN.md`... and `EXPERIENCE.md`... both `status: final`; the earlier single-`md` rule was written on 2026-07-19 while the 'UX Design Requirements' section still read 'no UX design contract exists', and the UX artifacts landing the same day superseded it."_ In other words, `epics.md`'s own governing section now says `AD-21` was the stale one, not the UX spine.
  5. **However, `epics.md`'s own per-story AC bullets were not updated to match.** Story 4.3's literal AC text in `epics.md` (the one this story's AC #12/#6 is sourced from) still reads _"Given a viewport narrower than the shared `md` breakpoint (768px)..."_ — unrevised, alongside Stories 3.2, 3.3, and 5.1's equivalent bullets. `ARCHITECTURE-SPINE.md#AD-21` itself was also not repatched.
  6. **Story 3.3** (already written, dated after the 2026-07-20 `epics.md` correction) explicitly treats the correction as settled fact: _"That ambiguity was corrected 2026-07-20: `epics.md`'s 'Shared UI conventions' section now states `lg` (1024px) governs the result page and history sidebar... This story is unaffected either way... but is recorded here in case the correction wasn't yet visible when this story was read."_
- **Net assessment:** every dated, cross-referenced signal _except_ `AD-21` itself and the un-patched literal AC bullets now points to `lg`/1024px as the real structural value for the dual-panel↔tabs collapse Story 3.2 must implement, and a sibling story (3.3) already treats this as resolved. `AD-21` reads as the one artifact that has not yet caught up. This story was instructed to write against `md`/768px specifically citing AD-21's authority — that instruction is followed literally above (AC #12/#6 cite "the shared structural breakpoint" without hardcoding a number, and no component here contains a literal `768` or `1024`), but the concrete recommendation is: **whoever authors Story 3.2 should implement `lg` (1024px)**, and `AD-21` should be patched to match rather than the reverse. If 3.2 lands on `lg`, nothing in this story needs to change — the props contract above was deliberately built not to encode a pixel value. If a future reader needs a literal number for a Playwright viewport project (Story 5.2), use `1024` pending that reconciliation, not `768`.

### Markdown-to-HTML gap (decision made in this story, not previously specified)

No source document — not `DESIGN.md`, `EXPERIENCE.md`, `ARCHITECTURE-SPINE.md`, nor `epics.md` — names a markdown-parsing library. They only ever say "DOMPurify sanitizes chat/explanations." DOMPurify sanitizes **HTML**; it does not parse markdown. Since `{typography.code}` exists specifically for "inline code and fenced blocks inside explanations and chat," and the assistant is expected to cite doc sections, bold key terms, and link sources, assistant output is expected to arrive as markdown and must be converted to HTML before sanitization. **Decision:** use `marked` (verified resolvable via `pnpm view marked version` → `18.0.6`, 2026-07-20) for markdown → HTML, then `DOMPurify.sanitize(...)` the result. This is this story's own call, flagged here so a reviewer can override it if a different library was intended elsewhere.

### DOMPurify — verified version + exact config

- **Verified 2026-07-20:** `pnpm view dompurify version` → `3.4.12`; `pnpm view @types/dompurify version` → `3.2.0`. (`ARCHITECTURE-SPINE.md#Stack` lists DOMPurify only as "latest" — this pins the number.)
- **React 19 / Next.js 15 client-component usage.** DOMPurify requires a live DOM (`window`/`document`). A `'use client'` component in the App Router is still rendered once on the server for the initial HTML before hydration — calling the DOMPurify factory at that point throws or silently no-ops depending on how it's invoked. **Guard:** `sanitize.ts` checks `typeof window === 'undefined'` and returns `''` in that branch; the client re-render after hydration produces the real sanitized output. (The alternative, `isomorphic-dompurify`, wraps `jsdom` to make SSR sanitization work — not adopted here to avoid an extra dependency for a codepath, chat/explanation content, that is only ever fetched client-side after hydration anyway, so there is nothing to sanitize during the SSR pass in the first place.)
- **`target="_blank"` handling** — DOMPurify does not add `rel` automatically. Use the `afterSanitizeAttributes` hook (verified pattern, cure53/DOMPurify demos):
  ```ts
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  ```
- **`RETURN_TRUSTED_TYPE`** — not needed here. It only matters when a page enforces a Trusted-Types CSP directive; Story 1.5's CSP is on the **API** (`helmet`), and no story pins a Trusted-Types policy on the Vercel-hosted web app. Leave the DOMPurify default (`RETURN_TRUSTED_TYPE: false`, returns a plain string suitable for `dangerouslySetInnerHTML`). If a later story adds a Trusted-Types CSP to `apps/web`, this file will need `RETURN_TRUSTED_TYPE: true` plus a `trustedTypes.createPolicy` wrapper — not required today.
- **Exact config:**
  ```ts
  const CHAT_SANITIZE_CONFIG = {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'ul',
      'ol',
      'li',
      'a',
      'code',
      'pre',
      'blockquote',
      'h1',
      'h2',
      'h3',
      'h4',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    ALLOWED_ATTR: ['href', 'title'],
    ALLOW_DATA_ATTR: false,
  } as const;
  ```
  This is scoped to chat + explanations **only** (AD-N1, ARCHITECTURE-SPINE.md#AD-N1 rule 2). Question and answer text must never pass through this function — Task 4 explicitly calls this out at the component level to prevent the two rendering paths from merging.

### Chat API contract (provisional — Story 4.1 has no story file yet)

Story 4.1 (chat backend) had not been authored as of this writing either (checked immediately before writing this file). The shapes below are derived from `epics.md` Story 4.1's ACs + the PRD + `ARCHITECTURE-SPINE.md`'s ERD, and are what this story's data layer (Task 3) is built against. Reconcile against Story 4.1's actual contract once it exists.

```ts
interface ChatMessageDto {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string | null; // null = tombstoned (Story 4.4, 7-day scrub)
  sources: { title: string; url: string }[] | null;
  toolCalls: unknown[] | null; // opaque to the UI — only used to render a badge (AC #11)
  model: string | null;
  thinking: unknown | null; // present, NEVER rendered (AC #10)
  createdAt: string; // ISO 8601
}
```

- `GET /api/sessions/:id/chat` → `{ messages: ChatMessageDto[] }`, latest 50, **no `limit`/`offset` query params** (epics.md Story 4.1 AC: "no LIMIT/OFFSET pagination"). "View older" calls the same endpoint with `?before=<oldest-loaded createdAt>` — a cursor, not an offset — and receives the previous batch.
- `POST /api/sessions/:id/chat` request: `{ "content": string }` (≤8000 chars). Response: `{ userMessage: ChatMessageDto, assistantMessage: ChatMessageDto }`.
- **Tombstone wire shape is this story's proposal for Story 4.4 to implement against** (4.4 lands after this story in the epic sequence): a scrubbed row returns `content: null`, all other fields intact. If Story 4.4 lands on a different representation (e.g. a sentinel string, a `tombstoned: boolean` flag), this story's rendering branch (Task 4) must be updated to match — flagged here so that reconciliation is a known, expected step, not a surprise.
- **409 on non-`submitted` status** is a defense-in-depth response this UI should never trigger given the Story 3.2 guard above, but the mutation error handler must not crash on it — map it to a generic error state rather than assuming every failure is a 5xx/429.

### Architecture compliance checklist

- **AD-17 (FE state split):** TanStack Query for all server state (chat history + send mutation); no new Context (see § Chat slot contract); local `useState` for input text, sending flag, and any per-message error UI.
- **AD-N1 (plain-text Q/A / DOMPurify scoping):** enforced structurally — `sanitizeChatHtml` lives in one file, is called from exactly one component (`chat-message.tsx`, assistant branch only), and question/answer rendering is out of this story's files entirely (owned by 3.2/3.3).
- **AD-12 (chat pre-submit guard):** server-side only, unreachable via this UI (see § Pre-submit state above) — no client code references a `ready`-session chat state.
- **AD-21 / breakpoint:** no literal pixel value or arbitrary Tailwind variant (`min-[…]`, `max-[…]`) appears anywhere in this story's components — see § Breakpoint conflict.
- **No `questionId` anchor, ever:** `ChatPanelProps`, `ExplainQuestionButtonProps`, and the `POST /chat` request body above all omit it by construction. Grep for `questionId` in this story's new files should return zero matches outside comments.
- **`@ai-quiz/require-data-testid`:** every button/input/anchor in Tasks 4–6 carries `data-testid` (naming scheme below); the lint rule itself was built earlier (project-context.md, "ships with the first UI stories") and should already be enforcing this.

### `data-testid` naming scheme

| Element                         | `data-testid`                                                          |
| ------------------------------- | ---------------------------------------------------------------------- |
| Chat panel root                 | `chat-panel`                                                           |
| Thread container (`role="log"`) | `chat-thread`                                                          |
| One message bubble              | `chat-message` (repeat per message; Playwright indexes with `.nth(n)`) |
| Per-message retry button        | `chat-message-retry`                                                   |
| "View older" button             | `chat-view-older`                                                      |
| Empty-state quick-action chip   | `chat-quick-action-study-next`, `chat-quick-action-weakest`            |
| Message input                   | `chat-input`                                                           |
| Send button                     | `chat-send`                                                            |
| Typing indicator                | `chat-typing-indicator`                                                |
| Rate-limited banner             | `chat-rate-limited`                                                    |
| Per-question explain control    | `explain-question-{n}` (1-based `n`, e.g. `explain-question-3`)        |

### Design tokens consumed (`DESIGN.md`, exact values — do not approximate)

| Token                                 | Value                                                                    | Used for                                                               |
| ------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `{colors.surface-sunken}`             | `#F1EDE7` (dark `#141210`)                                               | `chat-message-user` bubble fill                                        |
| `{colors.ink}`                        | `#2A2723` (dark `#EDE9E2`)                                               | `chat-message-assistant` text                                          |
| `{colors.accent}`                     | `#A85A2B` (dark `#E29B6B`)                                               | focus ring only (2px, 2px offset) — never decorative                   |
| `{rounded.lg}`                        | 14px                                                                     | chat bubble corners                                                    |
| `{typography.reading}`                | Geist Sans 17px/400/1.65, capped at `reading-measure` 68ch               | assistant message body                                                 |
| `{typography.code}`                   | Geist Mono 14px/1.6                                                      | inline code / fenced blocks inside sanitized assistant HTML            |
| `{components.chat-message-user}`      | `surface-sunken` fill, `rounded.lg`, right-aligned, max 80% column width | user bubble                                                            |
| `{components.chat-message-assistant}` | transparent, full width, `{typography.reading}`                          | assistant bubble — "reads as the document talking back, not a chatbot" |
| `{components.focus-ring}`             | 2px `accent`, 2px offset                                                 | every focusable element in the panel                                   |

Never introduce red/`destructive` styling for the error state (per DESIGN.md's "never introduce" list) — use the existing muted, non-alarm palette; an inline retry affordance, not a red banner.

### Voice & tone (`EXPERIENCE.md`) — applies to any first-party copy this story writes

Second person, present tense, no exclamation marks, no emoji, no gamification language. The empty-state framing line and error copy must follow this (e.g. not "Oops! Something went wrong 😅" — instead "That message didn't send. Try again."). Assistant-generated content is the LLM's own voice (governed by the chat system prompt, out of this story's scope) — this rule binds only the UI's own static strings.

### Previous story intelligence (Story 2.7, closest prior UI story)

- **FE substrate already exists by the time this story runs**: `apps/web/lib/api.ts` (fetch wrapper, `X-User-Id` injection, `{error:{code,message,requestId}}` parsing), `apps/web/lib/queries.ts` (query-keys factory — extend it, do not fork a second one), `apps/web/lib/user-context.tsx`, `apps/web/components/states/` (`NarratedWait`, `ErrorState`, `RateLimitedState`, `EmptyState` — reuse `RateLimitedState`'s countdown logic for AC #5's 429 case rather than re-implementing it; **do not** reuse `EmptyState` verbatim for AC #3, since the chat empty state needs quick-action chips that the generic component doesn't support — either extend it with an optional children slot or build a small chat-specific wrapper around it, dev's choice).
- **2.7 built `apps/web/lib/error-copy.ts`** (`error.code` → human copy map) — extend it with the 409 and rate-limit-on-chat entries this story needs rather than forking a parallel map.
- **2.7 explicitly deferred `apps/web/lib/sanitize.ts` to this story** ("First story to need it builds it") — confirmed, this is genuinely new here.
- **2.7 flagged the breakpoint conflict as unresolved and blocking 3.2/3.3/4.3/5.1** — this story is one of the ones it named. See § Breakpoint conflict above for the full trail, including what's changed since 2.7 was written.
- **No frontend code exists yet in the repo beyond the Story 1.1 stub** (`apps/web/package.json`, empty `.gitkeep`'d directories) at the time 2.7 was authored. By the time this story is implemented, 2.7's and 3.3's components should exist — check `apps/web/components/` and `apps/web/lib/` for what's actually landed before assuming any file doesn't exist yet.

### Testing standards summary

- Vitest + `@testing-library/react` + `@testing-library/user-event` (jsdom), added by Story 2.7 — extend the existing `apps/web` Vitest project, do not add a new runner.
- Coverage per Task 9 above. `pnpm --filter @ai-quiz/web test` must be green before marking done.
- No Playwright work here — `chat.spec.ts` is Story 5.2's explicit deliverable (epics.md: "Given `chat.spec.ts`, Then it covers a post-submit message receiving a grounded response, And the client-side 'Explain Qn' prefill"). This story's job is to make sure every element that test will need already carries the right `data-testid`.
- `pnpm verify` remains the overall gate; `test:e2e` stays a no-op until Story 5.2 installs Playwright.

### Project Structure Notes

New files this story adds (nothing here should already exist):

```
apps/web/
  lib/
    sanitize.ts                          NEW — DOMPurify wrapper (chat + explanations)
  components/
    result/
      chat-panel.tsx                     NEW
      chat-thread.tsx                    NEW
      chat-message.tsx                   NEW
      chat-input.tsx                     NEW
      chat-empty-state.tsx               NEW
      explain-question-button.tsx        NEW — owned here, mounted by Story 3.2
apps/web/lib/queries.ts                  UPDATE — add chat query keys + hooks (Story 2.7 created this file)
apps/web/lib/error-copy.ts               UPDATE — add 409 / chat-rate-limit entries (Story 2.7 created this file)
apps/web/package.json                    UPDATE — add dompurify, @types/dompurify, marked
```

Do **not** create `apps/web/app/result/[id]/page.tsx`, the results panel, or anything under `apps/web/components/history/` — those belong to Stories 3.2 and 5.1 respectively.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3: Chat panel UI (mounted into the result-page shell)] — the binding ACs this story expands
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2: Result page (dual-panel shell + results panel)] — the mount point's own ACs (no story file exists for it yet)
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1: Chat backend — persistence + pre-submit guard] — chat_messages schema, redaction rule, 50-message/no-offset rule (no story file exists for it yet)
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements → Shared UI conventions] — breakpoint correction dated 2026-07-20, `data-testid` convention, `components/states/` reuse convention
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-21 — Single responsive breakpoint] — the `md`/768px rule this story was instructed to follow; see conflict note
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-17 — FE state split] — Context cap of two, TanStack Query for server state
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-N1 — Ingest neutralization + output grounding] — DOMPurify scoping rule, plain-text Q/A rule
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-12 — Chat pre-submit guard] — why this UI specs no pre-submit state
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#Stack] — DOMPurify version line ("latest") — pinned to `3.4.12` here, verified 2026-07-20
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/DESIGN.md#Colors, #Components] — exact hex tokens, chat bubble component specs, focus ring
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-ai-quiz-2026-07-19/EXPERIENCE.md#Component Patterns, #State Patterns, #Interaction Primitives, #Accessibility Floor, #Responsive & Platform, #Open Items] — empty/sending/error state behaviors, Explain-Qn behavior, live-region + keyboard rules, the `lg`/1024 breakpoint claim, Open Items #1/#5/#6
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-10, #FR-11, §4.4, §4.5] — chat contract, `topicsToStudy` element shape, no-insight-endpoint rationale
- [Source: _bmad-output/implementation-artifacts/2-7-landing-page-and-quiz-start-flow.md] — FE substrate already in place, shared state components, the breakpoint conflict as first flagged, `sanitize.ts` deferral
- [Source: _bmad-output/implementation-artifacts/3-3-quiz-taking-ui-one-question-at-a-time.md] — confirms the 2026-07-20 `epics.md` breakpoint correction as settled, from a story authored after it landed
- [Source: _bmad-output/project-context.md#Security Rules item 3, 3b, 4, 5] — chat-before-submit guard, DOMPurify scoping restated, no-insight-endpoint decision

## Open questions / conflicts

1. ~~**Breakpoint value for the dual-panel↔tabs collapse.**~~ **RESOLVED 2026-07-20 — the structural value is `lg` / 1024 px.** `AD-21` was amended and `epics.md`'s per-story AC bullets re-synced on 2026-07-20, both landing on `lg`; `md` / 768 px is now explicitly non-structural, and the spine states that a story using `md` for structure is a defect. This story requires no change (nothing here hardcodes a pixel value). Story 3.2 must implement `lg`. Original analysis retained below for provenance:

   `ARCHITECTURE-SPINE.md#AD-21` says `md`/768px; `DESIGN.md` + `EXPERIENCE.md` (both final) say `lg`/1024px; `epics.md`'s shared-conventions section was corrected 2026-07-20 to `lg`/1024px explicitly citing the UX docs; but `epics.md`'s own per-story AC bullets (including this story's) and `AD-21` itself were never repatched to match; Story 3.3 (already written, post-correction) treats `lg`/1024px as settled. This story was explicitly instructed to write against `md`/768px on the premise that `AD-21` is authoritative — that instruction is followed literally (no pixel value is hardcoded anywhere in this story's components; AC #6/#12 reference "the shared structural breakpoint" abstractly), but the evidence trail above points the other way. **Action needed:** patch `AD-21` and the stale `epics.md` AC bullets (3.2, 3.3, 4.3, 5.1) to agree with `lg`/1024px, or produce a countervailing decision explaining why `AD-21` should stand — before Story 3.2 is authored, since 3.2 is the story that actually implements the collapse.

2. **Story 3.2 does not exist.** The `ChatPanelProps`/`ExplainQuestionButtonProps` contract, the lifted-`pendingPrefill`-state requirement, the tab-switch-on-mobile requirement, and the `/result/[id]` non-submitted-session guard are all **this story's proposal** for what 3.2 must implement. Whoever authors 3.2 must reconcile explicitly against this file, not re-derive the contract from `epics.md` alone (which only says "mounts into the existing chat slot without rewriting the results panel" — it does not specify props).
3. **Story 4.1 does not exist.** The chat history/send API contract (endpoint shapes, cursor-based "view older," tombstone wire representation) is derived here from `epics.md`'s ACs + the PRD + the ERD, not read from an authored backend story. Reconcile Task 3's hooks against Story 4.1's actual response shapes once written.
4. **Tombstone wire shape is unowned upstream.** Story 4.4 (7-day scrub) also has no story file. This story picks `content: null` as the tombstone representation and asks 4.4 to implement against it — flagged in case 4.4's author independently picks a different shape (e.g. a `tombstoned: boolean` flag or a sentinel string).
5. **`topicsToStudy[]` element shape** was flagged by `EXPERIENCE.md` (Open Item #1) as blocking Story 4.1/inline insights, with no shape pinned in `packages/shared/src/schemas.ts` yet (confirmed: that file doesn't exist in code as of this writing, only `packages/shared/src/index.ts`). This story does not need the shape directly (the assistant consumes it server-side, per AC #8), but flags that Story 4.1 must pin `{topic: string; reason: string; docSnippets: string[]}[]` (per PRD §"FR-7 Idempotent submission") in the shared schema before this story's "What should I study next?" AC can be verified end-to-end.
6. **Markdown-to-HTML library (`marked`) is this story's own addition**, not specified anywhere upstream — flagged in Dev Notes § Markdown gap in case a different choice was intended elsewhere in the system (e.g. if Story 3.2 independently picks a different renderer for explanations, the two would diverge; this story's `sanitizeExplanationHtml` export is offered specifically to prevent that).
7. **Empty-state quick-action chips diverge slightly from `EXPERIENCE.md`'s illustrative example.** `EXPERIENCE.md` (Open Item #6, marked `[ASSUMPTION]`) suggests "What should I study next?" and "Explain Q1" as example chips. This story deliberately substitutes "Where am I weakest?" for "Explain Q1," because the latter requires per-question breakdown data (correctness, selection) that only Story 3.2 holds, and coupling the chat empty-state to that data would blur the mount-boundary this story is supposed to keep clean. Both of this story's chips are answerable purely from `insights` already in the chat's server-side context. Flagged as a deliberate deviation, not an oversight.
8. **AC #9's exact `ALLOWED_TAGS`/`ALLOWED_ATTR` list is this story's own judgment call** (no upstream source enumerates the tag allowlist) — reasonable for chat/explanation prose (headings, lists, tables, code, links) but not sourced from a spec; a reviewer may want to trim or extend it.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
