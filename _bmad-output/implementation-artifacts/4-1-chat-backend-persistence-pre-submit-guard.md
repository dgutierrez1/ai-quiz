# Story 4.1: Chat backend — persistence + pre-submit guard

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a persistent chat thread per session that can't leak answers before I submit,
so that I can ask follow-ups safely and revisit the conversation later.

## Acceptance Criteria

_(FR-9, FR-10, AD-12, AD-14 — carried forward verbatim from epics.md Story 4.1; do not weaken)_

1. **Given** the `chat_messages` table, **Then** it has `session_id`, `role` (`user`|`assistant`), `content` (≤8000), nullable `sources`/`tool_calls`/`model`/`thinking`, `created_at`, and `INDEX (session_id, created_at)`, with `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy, **And** it has no `question_id` column — chat is fully decoupled from questions.
2. **Given** `POST /sessions/:id/chat`, **Then** the request body accepts only `content` — there is no `questionId` field, **And** there is no focused-context branch in the chat flow.
3. **Given** a chat request while `status='ready'`, **Then** the LLM context receives a redacted `QuestionDto` with **no `is_correct` and no question text** (unit test asserts the redacted shape).
4. **Given** a chat request against a `failed` or `pending` session, **Then** it is refused with **409** and the current status — the guard must not fall through to the `submitted` branch and expose answers for a session that never produced any.
5. **Given** `status='submitted'`, **Then** the LLM context includes `finalScore`, `breakdown`, `categoryBreakdown`, and `insights.topicsToStudy` / `weakCategories` loaded as system content at session start.
6. **Given** a chat request, **Then** both the user and assistant turns persist and are returned, **And** content is Zod-capped at 8000 chars.
7. **Given** a chat history load, **Then** the latest 50 messages are returned with **no `LIMIT`/`OFFSET` pagination**, **And** older batches load on demand.
8. **Given** ownership, **Then** the chat route uses `@OwnsSession()`, **And** cross-user access returns 404 (isolation test).

### Additional acceptance criteria (derived from binding ADs and spec gaps this story must resolve — treat as equally required)

9. **Given** the new migration, **Then** it creates `chat_messages` sequenced strictly after whatever migration Story 3.1 lands (which creates `user_responses`/`insights`/`knowledge_categories`) — verify the actual next-available number in `apps/api/drizzle/` at dev time; do **not** renumber or regenerate any existing migration.
10. **Given** `chat_messages` has a `session_id` column directly, **Then** its RLS policy is **depth-1** (single `EXISTS` join to `quiz_sessions`) — the same shape as `documents`/`questions`, **not** the depth-2 `answers` shape (`answers` has no `session_id`; `chat_messages` does).
11. **Given** the redaction boundary (AD-3 "wire ≠ row"), **Then** a dedicated `RedactedQuestionSchema` (distinct from `QuestionRowSchema`/`QuizQuestionResponseSchema` from Story 2.6) defines the `ready`-status LLM-context shape as a schema-level projection — `{id, position, category, type}` only, with **no `text`, `answers`, or `isCorrect` key present at all** — never a runtime `delete` on the full row.
12. **Given** `status='submitted'`, **Then** the chat context additionally includes the full per-question data (text + answers + `isCorrect`) so the LLM can support "Explain Q3"-style follow-ups (Story 4.3 UI), sourced from the same `questions`/`answers` rows Story 2.6 persists — this is in addition to, not instead of, the `finalScore`/`breakdown`/`categoryBreakdown`/`insights` context from AC #5.
13. **Given** the pre-submit cache-prefix question left open by the spine (`ARCHITECTURE-SPINE.md#Deferred`, item "Chat cache prefix vs grounding chunks"), **Then** this story resolves it by building **no persistent cache prefix at all** while `status='ready'` — context is assembled fresh per chat turn from the redacted projection, never from a stored prefix that could carry source chunks (which contain every answer by construction).
14. **Given** `POST /sessions/:id/chat`, **Then** it is rate-limited at **20/min** (per-user AND per-IP, stricter wins — project-context rule 6 / AD-N7's route table), following the same per-route `@Throttle()` override mechanism Story 1.5 established (read its actual implementation before adding a second mechanism); a `GET` history route is covered by the existing global 30/min throttle with no override.
15. **Given** the ESLint rule `@ai-quiz/no-unscoped-session-query` (Story 1.4), **Then** every new chat repository query is either named `forUser*` or wrapped in an explicit `assertUserOwns(sessionId, userId)` call so `pnpm verify` stays green.
16. **Given** the Vitest suite, **Then** `apps/api/test/` covers every branch in AC #3–#8 plus the migration/RLS/ownership isolation tests listed in Testing Requirements below; use-case coverage ≥ 80%, adapter coverage ≥ 60% (NFR-4/AD-N10).

## Tasks / Subtasks

- [ ] **Task 1 — Shared Zod schemas** (AC: #1, #2, #3, #6, #11, #12)
  - [ ] In `packages/shared/src/schemas.ts` add:
    - `ChatMessageRowSchema` — `id`, `sessionId`, `role: z.enum(['user','assistant'])`, `content: z.string().max(8000).nullable()` (nullable **from the start**, not altered later — see Design Ruling below), `sources: z.unknown().nullable()`, `toolCalls: z.unknown().nullable()`, `model: z.string().nullable()`, `thinking: z.unknown().nullable()`, `createdAt`.
    - `ChatMessageRequestSchema` — `{ content: z.string().min(1).max(8000) }.strict()` — **no `questionId` field, ever.**
    - `ChatMessageWireSchema` — outbound per-message shape returned to the FE: `id`, `role`, `content`, `sources`, `toolCalls`, `model`, `createdAt`. **Omits `thinking`** — internal reasoning is not surfaced to the client in v1 (design ruling below).
    - `ChatTurnResponseSchema` — `{ userMessage: ChatMessageWireSchema, assistantMessage: ChatMessageWireSchema }` (the `POST` response).
    - `ChatHistoryResponseSchema` — `{ messages: ChatMessageWireSchema[], hasMore: z.boolean() }` (the `GET` response).
    - `RedactedQuestionSchema` — `z.object({ id: z.string().uuid(), position: z.number().int(), category: z.string(), type: z.enum(['single','multiple']) }).strict()`. `.strict()` is deliberate: an accidental extra key on the input object must throw at parse time, not silently pass through.
  - [ ] Add a Vitest assertion that `RedactedQuestionSchema`'s key set does **not** intersect `{'text','answers','isCorrect','explanation'}` — a structural guard against a future edit accidentally widening the schema.

- [ ] **Task 2 — Ports + domain errors** (AC: #4, #8)
  - [ ] `apps/api/src/domain/ports/chat-repository.port.ts` — `appendTurn(sessionId, userContent, assistant: {content, sources, toolCalls, model, thinking}): Promise<{userMessage, assistantMessage}>`, `findRecentForUser(sessionId, userId, before?: Date): Promise<{messages, hasMore}>`.
  - [ ] `apps/api/src/domain/quiz/errors/chat-not-available.error.ts` — `ChatNotAvailableError` carrying `currentStatus: 'pending' | 'failed'`. Mapped to **409** by `SafeExceptionFilter` (Task 8).
  - [ ] Both files import nothing from `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, `node:fetch` (AD-2).

- [ ] **Task 3 — Drizzle schema + migration** (AC: #1, #9, #10)
  - [ ] Add `chat_messages` to `apps/api/src/adapters/persistence/drizzle/schema.ts` (UPDATE — append; do not restructure Stories 1.3/2.6/3.1's tables). Columns per Data Model Contract below.
  - [ ] Generate the next sequential migration (`pnpm db:generate`) — **verify what number is actually next** in `apps/api/drizzle/` at dev time (Story 3.1's migration for `user_responses`/`insights`/`knowledge_categories` must exist and be numbered before this one; do not skip ahead or renumber it).
  - [ ] Append RLS DDL to the same migration:
    ```sql
    ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE chat_messages FORCE  ROW LEVEL SECURITY;

    CREATE POLICY user_chat_messages ON chat_messages
      USING (
        EXISTS (
          SELECT 1 FROM quiz_sessions s
          WHERE s.id = chat_messages.session_id
            AND s.user_id = current_session_user_id()
        )
      );
    ```
    This is the **depth-1** shape (same as `documents`/`questions` from Story 2.6) — `chat_messages` carries `session_id` directly, so it does **not** need the depth-2 two-table join `answers` requires.
  - [ ] Add `INDEX (session_id, created_at)` on `chat_messages` — the keyset history query (Task 6) rides this index.
  - [ ] Reuse `current_session_user_id()` from Story 1.4's migration — do not redefine it.

- [ ] **Task 4 — Chat context assembly (pure domain service)** (AC: #3, #5, #11, #12, #13)
  - [ ] `apps/api/src/domain/quiz/services/chat-context.service.ts` (pure, no I/O):
    - `redactQuestionsForChat(questions: QuestionWithAnswersDto[]): RedactedQuestionDto[]` — maps each question to `{id, position, category, type}` via `Object.freeze(RedactedQuestionSchema.parse(...))`. Input is the full internal shape (`QuestionRowSchema` + nested `AnswerRowSchema[]` from Story 2.6); output never contains `text`, `answers`, or `isCorrect`.
    - `buildSubmittedContext(session, submissionResult, questions): ChatSystemContext` — assembles `{finalScore, breakdown, categoryBreakdown, insights: {topicsToStudy, weakCategories}, questions: QuestionWithAnswersDto[]}` for the `submitted` branch (full question data, per AC #12, plus the scoring/insights payload per AC #5).
  - [ ] **No cache-prefix persistence anywhere in this service or its callers** — this resolves the spine's open Deferred item by explicit omission (AC #13). Context is recomputed per turn; do not add a `chat_cache_prefix` table, column, or in-memory store.
  - [ ] Domain purity: this file imports only domain types + Zod — no `drizzle-orm`, no `@nestjs/*` (AD-2).

- [ ] **Task 5 — `ChatUseCase`** (AC: #3, #4, #5, #6, #12)
  - [ ] `apps/api/src/domain/use-cases/ChatUseCase.ts` (UPDATE — the file/class shell was declared, not implemented, by Story 2.3; this story writes the real body).
  - [ ] `execute({sessionId, userId, content})`:
    1. `session = await quizRepo.findByIdAndUserId(sessionId, userId)` → `NotFoundError` → 404 if null (AD-9, unchanged pattern).
    2. **Explicit exhaustive branch on `session.status` — no fallthrough:**
       ```ts
       switch (session.status) {
         case 'ready': {
           const questions = await questionRepo.findWithAnswersForUser(sessionId, userId);
           systemContext = buildReadyContext(redactQuestionsForChat(questions));
           break;
         }
         case 'submitted': {
           const questions = await questionRepo.findWithAnswersForUser(sessionId, userId);
           const result = await submissionRepo.getResultForUser(sessionId, userId); // Story 3.1 contract — see Dev Notes
           systemContext = buildSubmittedContext(session, result, questions);
           break;
         }
         case 'pending':
         case 'failed':
           throw new ChatNotAvailableError(session.status); // → 409, current status in body
         default:
           assertNever(session.status); // exhaustiveness guard — new status values must be handled explicitly
       }
       ```
       **This is the single most important control-flow rule in the story.** Do not write `if (status !== 'ready') { /* treat as submitted */ }` — that silently folds `pending`/`failed` into the `submitted` branch and is exactly the exfiltration path AC #4 exists to close.
    3. Call `llmPort.chat({model: session.model, systemContext, history: allPersistedMessages, userMessage: content, allowFallback: true})` (chat path — fallback **enabled**, per Story 2.3's `allowFallback` gate; generation is the only path where it must be `false`).
    4. Persist both turns via `chatRepo.appendTurn(...)` and return the `ChatTurnResponseSchema` shape.
  - [ ] No history-length truncation is applied to the LLM context in this story (see Design Ruling below) — pass all persisted messages.

- [ ] **Task 6 — `LlmPort.chat()` real body in `MastraLlmAdapter`** (AC: #6)
  - [ ] Implement the stub left by Story 2.3. Input: `{model, systemContext: string, history: {role, content}[], userMessage: string, allowFallback: boolean}`. Output: `{content: string, model: string, thinking?: unknown}` (no `tools` param in this story — Story 4.2 extends the signature additively with an optional `tools` array; do not build tool-loop plumbing here).
  - [ ] Apply AD-4's untrusted-LLM handling: `safeParse` the response envelope, retry per the capability-class budget from `capabilities.ts` (Story 2.3), `UntrustedLlmOutputError` on final failure. A refusal string (`isRefusal()`) is graceful — persist it as an ordinary assistant message, do not throw.
  - [ ] Round-trip `reasoning_details` into the `thinking` jsonb column when the provider returns it (MiniMax-M3, per AD-6) — store as-is; do not parse or reshape it. Leave `null` when absent or on OpenRouter.

- [ ] **Task 7 — Drizzle repository + keyset history query** (AC: #7, #15)
  - [ ] `apps/api/src/adapters/persistence/drizzle/chat.repository.ts` implementing `ChatRepositoryPort`.
  - [ ] `findRecentForUser(sessionId, userId, before?)`:
    - No `before`: `ORDER BY created_at DESC LIMIT 51`, then reverse to chronological order, drop the 51st row if present and set `hasMore = true`.
    - With `before` (an ISO timestamp + tie-break id, e.g. `{createdAt, id}`): `WHERE (created_at, id) < (:beforeCreatedAt, :beforeId) ORDER BY created_at DESC LIMIT 51`, same trim/`hasMore` logic. The compound `(created_at, id)` comparison breaks ties deterministically when two messages share a millisecond timestamp — a plain `created_at < :cursor` comparison alone can skip or duplicate a row at the boundary.
    - **This is keyset (seek) pagination, not `LIMIT`/`OFFSET`** — satisfies AC #7 exactly. `OFFSET` is never used anywhere in this repository.
  - [ ] Method name follows the `forUser*`/`assertUserOwns` convention so `@ai-quiz/no-unscoped-session-query` (Story 1.4) passes.
  - [ ] Every returned row is `Object.freeze(ChatMessageRowSchema.parse(row))` (AD-3).

- [ ] **Task 8 — Controller + routes** (AC: #2, #4, #8, #14)
  - [ ] `apps/api/src/driving/sessions/chat.controller.ts` (or extend `sessions.controller.ts` if that's the established pattern from Story 1.4 — read it first):
    - `POST /api/sessions/:id/chat` — `@OwnsSession()`, `ZodValidationPipe(ChatMessageRequestSchema)` on the body, `@Throttle()` override at 20/min matching Story 1.5's per-route mechanism (do not invent a second throttle mechanism — extend the existing one).
    - `GET /api/sessions/:id/chat` — `@OwnsSession()`, optional `?before=` query param, returns `ChatHistoryResponseSchema`. No throttle override — covered by the global 30/min.
  - [ ] Extend `SafeExceptionFilter`'s error registry (Story 1.5/2.6 — read the actual implementation first) with `ChatNotAvailableError → 409`, response body carries `currentStatus` alongside the standard `{error:{code,message,requestId}}` envelope (same pattern AD-15 established for the submit 409).

- [ ] **Task 9 — Tests** (AC: #16)
  - [ ] `apps/api/test/unit/chat-context.service.test.ts` — `redactQuestionsForChat` structural assertion: `Object.keys(redacted[0]).sort()` equals exactly `['category','id','position','type']`; **and** a content-level assertion that `JSON.stringify(redacted)` does not contain a known fixture answer-text string. Both assertions are required — a key-set check alone would pass a bug that renamed `text` to `body` without removing it.
  - [ ] `apps/api/test/integration/chat-guard.test.ts` — `pending` → 409 with `currentStatus:'pending'`; `failed` → 409 with `currentStatus:'failed'`; **explicitly assert the response contains no `is_correct` and no question text in either 409 case** (proves no fallthrough, not just that a 409 was returned); `ready` → 200 with redacted context asserted server-side via a spy on `llmPort.chat`'s `systemContext` argument; `submitted` → 200 with full context asserted via the same spy.
  - [ ] `apps/api/test/integration/chat-persistence.test.ts` — both turns persist; content ≤8000 enforced (8001-char request → 400); `questionId` in the request body is rejected or ignored-and-absent-from-storage (assert the column doesn't exist / the request schema is `.strict()` and rejects unknown keys).
  - [ ] `apps/api/test/integration/chat-history.test.ts` — keyset pagination: seed 60 messages, first `GET` returns latest 50 chronological + `hasMore:true`; `before` cursor fetches the next batch with no overlap and no gap; exact tie-break behavior when two seeded rows share a `created_at` millisecond.
  - [ ] `apps/api/test/security/rls-chat.security.test.ts` — direct `SELECT` on `chat_messages` with `app.user_id` unset, as table-owner role, returns 0 rows (extends Story 1.4/2.6's RLS test pattern).
  - [ ] `apps/api/test/security/ownership-chat.security.test.ts` — user A's chat is invisible to user B via both `GET` and `POST` (404).
  - [ ] Run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify` before marking done.

## Dev Notes

### Scope boundary — read this first

This story delivers **persistence + the pre-submit guard + a single non-tool-calling chat turn**. It does **not** build the Tavily tool loop or dual-LLM summarization.

| Do NOT build here | Owned by |
|---|---|
| `WebSearchPort`, `TavilySearchAdapter`, tool-execution loop (≤2 iterations), dual-LLM summarization | **Story 4.2** |
| Chat panel UI, "Explain Qn" client-side prefill, message input, `data-testid` | **Story 4.3** |
| 7-day content scrub / tombstone job, cron wiring | **Story 4.4** |
| `SubmitAnswersUseCase`, `user_responses`/`insights`/`knowledge_categories` tables and their RLS policies, the actual `finalScore`/`breakdown`/`categoryBreakdown`/`insights` **computation** | **Story 3.1** — this story only **consumes** that output (see below) |
| `MastraLlmAdapter`'s routing/lazy-load/fallback plumbing, `PROVIDER_CAPABILITIES` | **Story 2.3** (already built — this story fills in `chat()`'s real body only) |
| `questions`/`answers` persistence, `QuestionRowSchema`/`AnswerRowSchema`/`QuizQuestionResponseSchema` | **Story 2.6** (already built — this story reads via the existing repository, does not re-persist) |

### ⚠️ Consumed contract: Story 3.1's `finalScore`/`breakdown`/`categoryBreakdown`/`insights` shape

**Story 3.1 may not have a story file yet when this story is authored/implemented.** Its output shape is taken from `epics.md` Story 3.1's ACs and the PRD's `SubmitResponse` type (FR-7), reproduced here for reference — **this story does not own or validate this shape, it only forwards whatever Story 3.1 actually produces**:

```ts
type SubmitResponse = {
  sessionId: uuid;
  finalScore: number;
  breakdown: { questionId, position, rawScore, weight, weightedScore, correctAnswers }[];
  categoryBreakdown: CategoryPerformanceDto[];
  insights: {
    topicsToStudy: { topic: string; reason: string; docSnippets: string[] }[];
    weakCategories: string[];
    strengthByCategory: 'strong' | 'mixed' | 'weak';
  };
};
```

Integrate against whatever repository method/port Story 3.1 actually exposes for reading this back (e.g. `submissionRepo.getResultForUser(sessionId, userId)`) — do not re-derive or recompute scoring here; `packages/shared/scoring.ts` (AD-16) remains the single source of that logic. If Story 3.1's actual shape diverges from the sketch above, follow what was actually built and flag the divergence rather than silently reconciling it (same precedent Story 2.6 set for forward Epic-2 dependencies).

⚠️ **`insights.strengthByCategory` shape is ambiguous in the source material — flagged, not resolved, here.** See Open questions/conflicts below.

### Architecture compliance (binding)

- **AD-12 — chat pre-submit guard (this story's core).** `ChatUseCase` checks `status` and branches to a redacted `QuestionDto` (`ready`) or the full DTO (`submitted`). The unit test asserting the redacted shape must be **structural** (key-set equality + content-absence), not a single-field spot check — this is explicitly called out because a spot check (e.g. `expect(redacted.isCorrect).toBeUndefined()`) would pass even if `text` were still present under a different property name.
- **AD-3 — "wire ≠ row" / "row ≠ request" clarification.** `RedactedQuestionSchema` is a **new, distinct schema**, not a subset produced by deleting keys from `QuestionRowSchema` at runtime. The projection happens by parsing the redacted shape from the full data — Zod's `.strict()` schema is what makes the guard structural rather than convention-based.
- **AD-9 — ownership.** Both `GET` and `POST` chat routes carry `@OwnsSession()`; both throw `NotFoundError` → 404 for not-found and not-owned alike, never 403.
- **AD-14 — Drizzle-only, parameterized.** The keyset query's `(created_at, id) < (?, ?)` comparison uses Drizzle's `and`/`lt` builders (or a `sql` template tag with `$1/$2` placeholders) — never string-interpolated timestamps.
- **AD-4 — LLM untrusted.** The chat response is `safeParse`d against the (loose, since chat output is free text) `ChatResponseDto` shape; retries follow the capability-class budget from `capabilities.ts`. A refusal string is not an error — persist it.
- **AD-6 — chat-path fallback enabled.** `allowFallback: true` on every `ChatUseCase` call to `llmPort.chat(...)` — this is the one path in the whole system where the transparent OpenRouter→MiniMax fallback (Story 2.3 Task 4) is meant to fire.
- **Consistency Conventions — Zod field cap.** `chat.content ≤ 8000` enforced by `ChatMessageRequestSchema`, independently re-enforced by `ChatMessageRowSchema` at the read boundary (do not trust the request validation to hold forever, same rule Story 2.6 applied to `question.text`/`explanation`).

### Design rulings made here (spec was silent — follow these)

1. **`content` is nullable in the Drizzle/Zod row schema from day one**, even though this story always writes it non-null. Story 4.4's 7-day scrub job nulls `content` (and `thinking`/`sources`) in place — declaring the column nullable now avoids a schema-widening `ALTER COLUMN` migration later just to relax a `NOT NULL` constraint that was never load-bearing.
2. **`ChatMessageWireSchema` omits `thinking`.** Internal model reasoning (MiniMax-M3's `reasoning_details`) is stored for observability/debugging but is not part of any UI requirement in Epic 4 (Story 4.3's ACs list `content`, `sources`, and message metadata for display — not a "show reasoning" affordance). If a future story wants to surface it, that is a new AC, not an implicit extension of this one.
3. **No LLM-context history truncation.** No source document specifies a turn limit for what's fed back to the model each turn. Ruling: pass the full persisted thread. The 8000-char per-message cap combined with MiniMax-M3's 1M-token context window make this safe at v1 scale (even 50 max-length messages is ~400k chars, well under budget); adding an arbitrary window (e.g. "last 20 messages") would be unrequested complexity. If chat threads grow pathologically long in practice, a later story can add windowing — nothing here blocks it.
4. **No persistent chat cache prefix (resolves spine Deferred item "Chat cache prefix vs grounding chunks").** The spine flagged this exact decision as open and suggested "the safe default is to build no cache prefix while `status='ready'`." This story takes that default and extends it to **all** statuses for simplicity and safety — context is assembled fresh per turn (Task 4), never persisted or reused across turns as a stored prefix. MiniMax-M3's automatic caching (provider-side, no explicit `cache_control` needed per AD-6) already captures whatever caching benefit exists without any app-level state.
5. **`GET /api/sessions/:id/chat` is a new route inferred from AC #7's "chat history load," not explicitly named in `epics.md`.** `epics.md` only writes `POST /sessions/:id/chat` literally. A dedicated `GET` for history (rather than folding the thread into `GET /sessions/:id`'s response) keeps that route's payload bounded and matches Story 4.3's UI needing to re-fetch older batches independently of the results panel. Flagged in Open questions below in case a different shape was already decided elsewhere.
6. **`ChatNotAvailableError → 409` with `currentStatus` in the body** mirrors the pattern AD-15 established for the submit 409 (Story 3.1) — no source document assigns chat's 409 an exact body shape, so this story follows the sibling precedent rather than inventing an unrelated one.

### Data Model Contract

```
chat_messages
  id           uuid PK default gen_random_uuid()
  session_id   uuid NOT NULL REFERENCES quiz_sessions(id)
  role         text NOT NULL              -- 'user'|'assistant'
  content      text NULL                  -- ≤8000 chars; nullable now for Story 4.4's future tombstone (Design Ruling 1)
  sources      jsonb NULL                 -- always NULL until Story 4.2 (Tavily)
  tool_calls   jsonb NULL                 -- always NULL until Story 4.2
  model        text NULL                  -- 'provider/model' string used for this turn
  thinking     jsonb NULL                 -- MiniMax-M3 reasoning_details, round-tripped when present
  created_at   timestamptz NOT NULL default now()

INDEX idx_chat_messages_session_id_created_at ON chat_messages (session_id, created_at)
```

No `question_id` column — this is explicit and load-bearing (AC #1). `answers` is the only depth-2 RLS table in the system; `chat_messages` joins `quiz_sessions` directly (depth-1), same as `documents`/`questions`.

### RLS migration — depth-1, reusing the existing helper

```sql
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE  ROW LEVEL SECURITY;

CREATE POLICY user_chat_messages ON chat_messages
  USING (
    EXISTS (
      SELECT 1 FROM quiz_sessions s
      WHERE s.id = chat_messages.session_id
        AND s.user_id = current_session_user_id()
    )
  );
```

`current_session_user_id()` already exists from Story 1.4's migration (`0001`) — do not redefine it. `FORCE` is mandatory or Neon's table-owner role bypasses RLS entirely (AD-9).

### File Structure Contract

```
apps/api/src/
  domain/
    ports/
      chat-repository.port.ts               NEW
    quiz/
      errors/
        chat-not-available.error.ts          NEW
      services/
        chat-context.service.ts              NEW — redactQuestionsForChat, buildSubmittedContext
    use-cases/
      ChatUseCase.ts                         UPDATE (shell from Story 2.3 → real body)
  adapters/
    persistence/drizzle/
      schema.ts                              UPDATE (append chat_messages)
      chat.repository.ts                     NEW
    llm/
      MastraLlmAdapter.ts                    UPDATE (Story 2.3 — fill in chat() body)
  driving/
    sessions/
      chat.controller.ts                     NEW (or extend sessions.controller.ts — check Story 1.4's actual file first)
    middleware/
      safe-exception.filter.ts               UPDATE (Story 1.5/2.6 — add ChatNotAvailableError → 409)
apps/api/drizzle/                            NEW migration (chat_messages + RLS), sequenced after Story 3.1's
apps/api/test/
  unit/chat-context.service.test.ts          NEW
  integration/chat-guard.test.ts             NEW
  integration/chat-persistence.test.ts       NEW
  integration/chat-history.test.ts           NEW
  security/rls-chat.security.test.ts         NEW
  security/ownership-chat.security.test.ts   NEW
packages/shared/src/schemas.ts               UPDATE — ChatMessageRowSchema, ChatMessageRequestSchema,
                                              ChatMessageWireSchema, ChatTurnResponseSchema,
                                              ChatHistoryResponseSchema, RedactedQuestionSchema
```

Naming per spine Consistency Conventions: kebab-case files, PascalCase classes, camelCase vars, `*.port.ts`/`*.adapter.ts`/`*.dto.ts` suffixes. `ChatUseCase.ts`/`MastraLlmAdapter.ts` keep the PascalCase filenames the spine's own source tree uses for these two specific files (same precedent Story 2.3 followed).

### Testing Requirements

- **Framework:** Vitest. Integration + security tests in `apps/api/test/` (never colocated in `src/`); pure unit test for the redaction service in `apps/api/test/unit/`.
- **Coverage floors (NFR-4/AD-N10):** use-cases ≥ 80%, adapters ≥ 60%.
- **Real Postgres required** for the RLS and keyset-pagination tests — do not mock the DB for either; run the RLS test as the table-owner role (Story 1.4/2.6's established pattern).
- **The redaction structural test is the highest-value test in this story** — it is the concrete proof behind AD-12's guard. It must fail if `text`/`answers`/`isCorrect`/`explanation` appears on the redacted object under any name, not just the literal ones checked structurally — hence the additional `JSON.stringify` content-absence assertion.
- **The `pending`/`failed`-returns-409-with-no-answer-content test is the second-highest-value test** — it directly proves the no-fallthrough requirement (AC #4), which is easy to get subtly wrong with an `if (status !== 'ready')` shortcut.
- Before completing: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify` (`lint:check && typecheck && test && test:e2e && build`).

### Anti-pattern watchlist

- ❌ Adding a `question_id` column, a `questionId` request field, or any focused-context branch to the chat flow — explicitly removed by the 2026-07-19 decision; reintroducing it is exactly the regression this story's ACs guard against.
- ❌ `if (status !== 'ready') { /* assume submitted */ }` — folds `pending`/`failed` into the answer-bearing branch. Use the exhaustive `switch` with an `assertNever` default.
- ❌ Producing the redacted shape via `delete obj.isCorrect` / `delete obj.text` on the full row object — not a schema-level projection, one missed field away from leaking. Parse into `RedactedQuestionSchema` from scratch.
- ❌ Implementing `LIMIT`/`OFFSET` for the "older batches" history load — explicitly forbidden by AC #7; use the `(created_at, id)` keyset comparison.
- ❌ Persisting a "chat cache prefix" (table, column, or in-memory store) containing source chunks or full question text while `status='ready'` — reopens the exact exfiltration route AD-12 exists to close.
- ❌ Building the Tavily tool loop, `WebSearchPort`, or dual-LLM summarization here — Story 4.2's scope entirely.
- ❌ Recomputing `finalScore`/`categoryBreakdown`/`insights` inside this story's `ChatUseCase` — that duplicates `packages/shared/scoring.ts` and Story 3.1's `CategoryAggregatorService`; forward whatever they produce.
- ❌ Defaulting `allowFallback` to anything other than an explicit `true` on every chat call — Story 2.3 made this a required, non-defaulted parameter specifically so a caller cannot silently pick the wrong value; the generation path needs `false`, chat needs `true`.

### Project Structure Notes

- Aligns with spine "Minimal source tree" (`domain/use-cases/ChatUseCase.ts`, `adapters/llm/MastraLlmAdapter.ts`, `chat_messages` ERD entry) verbatim.
- Build-order position: this is the first Epic 4 story, depending on Epic 2 (Stories 2.3's `LlmPort`/`MastraLlmAdapter` shell, 2.6's `questions`/`answers` persistence) and Epic 3 (Story 3.1's submission result) both being complete. **Do not start implementation before Story 3.1 is done** — the `submitted`-branch context assembly has no data source otherwise.
- **Previous-story intelligence carried forward:** the `set_config('app.user_id', ...)` pattern (never literal-interpolated `SET LOCAL`, per Story 1.4), the `forUser*`/`assertUserOwns` naming convention for the lint rule, the depth-1 vs depth-2 RLS distinction (Story 1.4's template, Story 2.6's concrete application), the "failure state / async work must open its own transaction with its own GUC" rule (Story 1.4/2.6) — **not directly needed by this story's happy path** since chat is fully synchronous within the request transaction, but relevant if a future revision adds any post-response chat work. The `AnswerRowSchema`/`QuestionRowSchema`/`QuizQuestionResponseSchema` split from Story 2.6 is the direct precedent this story's `RedactedQuestionSchema` extends one level further (redacting text too, not just `isCorrect`).
- No UX design contract applies to this story — it is backend-only; Story 4.3 owns the chat panel UI.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.1-Chat-backend-—-persistence-+-pre-submit-guard] — the eight base ACs, carried forward verbatim
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-4-Chat,-follow-ups-&-gap-analysis] — epic framing; "chat is free text, fully decoupled from questions" decision date
- [Source: _bmad-output/planning-artifacts/epics.md#Story-3.1-Submit,-score-&-serve-results] — `SubmitResponse` shape this story consumes (not yet its own story file at authoring time)
- [Source: ARCHITECTURE-SPINE.md#AD-12 — Chat pre-submit guard] — redacted vs full `QuestionDto`, unit-test requirement
- [Source: ARCHITECTURE-SPINE.md#AD-3 — Zod DTOs at every boundary (canonical pattern)] — "wire ≠ row" clarification; `RedactedQuestionSchema` named directly in this AD's text
- [Source: ARCHITECTURE-SPINE.md#AD-9 — Ownership per request + Postgres RLS (v1)] — depth-1 vs depth-2 policy shapes; `@OwnsSession()`; 404-never-403
- [Source: ARCHITECTURE-SPINE.md#AD-14 — Drizzle-only persistence] — `$1/$2` placeholders, no raw `pg`
- [Source: ARCHITECTURE-SPINE.md#AD-4 — LLM untrusted] — safeParse + retry budget, `isRefusal()` graceful handling
- [Source: ARCHITECTURE-SPINE.md#AD-6 — Provider-agnostic via Mastra] — chat-path fallback enabled, `allowFallback` gate (Story 2.3)
- [Source: ARCHITECTURE-SPINE.md#AD-N7 — Rate limiting] — `POST /api/sessions/:id/chat` 20/min, stricter-wins per-user+per-IP
- [Source: ARCHITECTURE-SPINE.md#Core-entity-ERD] — `chat_messages` column list
- [Source: ARCHITECTURE-SPINE.md#Deferred] — "Chat cache prefix vs grounding chunks" item, resolved by this story (Design Ruling 4); "insights writer + topicsToStudy shape" item (Open questions below)
- [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions] — `chat.content ≤ 8000` field cap
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-9] — chat-before-submit guard
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-10] — chat persistence, no-pagination, no-questionId-anchor decision, "Explain Q3" client-side prefill note
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-7] — `SubmitResponse` shape (`finalScore`/`breakdown`/`categoryBreakdown`/`insights`) this story forwards into chat context
- [Source: _bmad-output/project-context.md#Security-Rules] — rule 3 (chat-before-submit guard), rule 3b (gap analysis via chat, no insight endpoint), rule 6 (rate limits table)
- [Source: _bmad-output/implementation-artifacts/1-3-api-skeleton-db-foundation-and-health-endpoints.md] — Drizzle `pg.Pool` client, migration `0000`
- [Source: _bmad-output/implementation-artifacts/1-4-per-session-ownership-walking-skeleton-sessions-endpoint.md] — `set_config` pattern, `@OwnsSession()`, depth-1/depth-2 RLS template, `@ai-quiz/no-unscoped-session-query`, migration `0001`
- [Source: _bmad-output/implementation-artifacts/2-3-provider-agnostic-llm-adapter-provider-list-endpoint.md] — `LlmPort.chat()` stub, `allowFallback` gate mechanics, capability-class retry budgets
- [Source: _bmad-output/implementation-artifacts/2-6-persist-the-quiz-failure-state-and-enrichment.md] — `QuestionRowSchema`/`AnswerRowSchema`/`QuizQuestionResponseSchema` split (the direct precedent for `RedactedQuestionSchema`), RLS migration sequencing discipline, `SafeExceptionFilter` extension pattern
- [Source: AGENTS.md#Stop-and-ask-before] — data-model changes (new table + column), reintroducing removed controls (no HMAC, no keyword blocklist), adding `user_id` to child tables (chat_messages correctly has none)

### Open questions / conflicts (non-blocking — flagged for the human)

1. **`insights.strengthByCategory` shape is ambiguous across source documents — a genuine unresolved conflict, not silently picked here.** The PRD's `SubmitResponse` type (§4.4/FR-7) writes `strengthByCategory: 'strong' | 'mixed' | 'weak'` as a single top-level enum with an inline comment `// per-category` — internally contradictory as written, since `strength` is inherently a per-category value (`knowledge_categories.strength`, populated per row by AD-16) and `categoryBreakdown[]` already carries it per category. The spine's own Deferred log flags the same gap ("insights writer + topicsToStudy shape... `topicsToStudy[]` has no element type or derivation rule beyond 'computed at submit'... revisit condition: resolve in Story 3.1"). **This story does not need to resolve it** — the `ChatUseCase`'s submitted-branch context assembly forwards whatever `insights` object Story 3.1 actually produces, structurally agnostic to whether `strengthByCategory` ends up as a single value or a per-category map. Flagging so Story 3.1's author resolves the PRD/spine gap once, rather than this story guessing a shape that Story 3.1 then contradicts.
2. **`GET /api/sessions/:id/chat` as a dedicated history route is this story's own ruling, not literally specified anywhere.** `epics.md` and the PRD only ever write `POST /sessions/:id/chat`. No source document names a `GET` route, though AC #7's "chat history load" clearly requires some fetch mechanism, and Story 4.3's UI needs to load older batches independently of the results panel. If a different shape was already decided in a document this workflow didn't surface (e.g. folding the thread into `GET /sessions/:id`'s payload), reconcile before Story 4.3 builds against this story's actual route.
3. **Migration sequencing depends on Story 3.1 already existing when this story is implemented.** Both `epics.md`'s build order (Epic 3 before Epic 4) and this story's own `submitted`-branch logic require Story 3.1's `user_responses`/`insights`/`knowledge_categories` migration to already be applied. If Epic 4 is ever implemented out of order relative to Epic 3, this story cannot be completed — flagged as a hard sequencing dependency, not a soft preference.
4. **`LlmPort.chat()`'s exact parameter shape (`{model, systemContext, history, userMessage, allowFallback}`) is this story's own design, extending Story 2.3's placeholder interface.** Story 2.3 explicitly left the DTO shape provisional pending the first real caller. Story 4.2 must **extend** this signature additively (e.g. an optional `tools` array) rather than redefine it, to avoid a second breaking change to the same port within one epic.

## Dev Agent Record

### Agent Model Used

_(to be filled by the dev agent)_

### Debug Log References

### Completion Notes List

### File List
