// apps/api/src/domain/chat/dto/chat.schemas.ts
//
// Story 4.1/4.2/4.4 — local Zod schemas for the chat boundary. These are NOT
// in `packages/shared/src/schemas.ts` because this iteration's file
// ownership is scoped to `apps/api/src/domain/chat/**` only (a concurrently
// running agent owns `packages/shared`) — same precedent Story 3.1 set in
// `domain/submission/dto/submission.schemas.ts`.
//
// AD-3 "row ≠ request ≠ wire" split, mirrored here:
//   - `ChatMessageRequestSchema` — inbound wire (POST /chat body)
//   - `ChatMessageRowSchema`     — DB row shape (chat_messages)
//   - `ChatMessageWireSchema`    — outbound wire (per-message, omits `thinking`)
//   - `ChatTurnResponseSchema`   — outbound wire (POST /chat response)
//   - `ChatHistoryResponseSchema`— outbound wire (GET /chat response)
//   - `RedactedQuestionSchema`   — AD-12 pre-submit LLM-context projection —
//     a schema-level projection, never a runtime `delete` on the full row.

import { z } from 'zod';

// ── Chat message row / wire ──────────────────────────────────────────────

export const ChatRoleSchema = z.enum(['user', 'assistant']);

export const ChatMessageRowSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: ChatRoleSchema,
  // Nullable from the start (Story 4.1 design ruling) — Story 4.4's 7-day
  // scrub nulls this in place rather than deleting the row.
  content: z.string().max(8000).nullable(),
  sources: z.unknown().nullable(),
  toolCalls: z.unknown().nullable(),
  model: z.string().nullable(),
  thinking: z.unknown().nullable(),
  scrubbedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export const ChatMessageRequestSchema = z
  .object({
    content: z.string().min(1).max(8000),
  })
  .strict();

// Outbound per-message shape. Deliberately OMITS `thinking` — internal model
// reasoning is stored for observability but is not a v1 UI requirement
// (Story 4.1 design ruling #2).
export const ChatMessageWireSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: ChatRoleSchema,
  content: z.string().max(8000).nullable(),
  sources: z.unknown().nullable(),
  toolCalls: z.unknown().nullable(),
  model: z.string().nullable(),
  // Story 4.4 — the single authoritative tombstone signal. The FE must check
  // `scrubbedAt !== null`, never infer scrub state from `content` matching.
  scrubbedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export const ChatTurnResponseSchema = z.object({
  userMessage: ChatMessageWireSchema,
  assistantMessage: ChatMessageWireSchema,
});

export const ChatHistoryResponseSchema = z.object({
  messages: z.array(ChatMessageWireSchema),
  hasMore: z.boolean(),
});

// ── AD-12 pre-submit guard: redacted question projection ────────────────
//
// `.strict()` is deliberate: an accidental extra key on the input object
// must throw at parse time, not silently pass through. This is the
// structural enforcement behind the guard — never a runtime `delete`.
export const RedactedQuestionSchema = z
  .object({
    id: z.string().uuid(),
    position: z.number().int(),
    category: z.string(),
    type: z.enum(['single', 'multiple']),
  })
  .strict();

// ── Story 4.2 — Tavily / dual-LLM sanitization DTOs ──────────────────────

export const WebSearchSourceSchema = z.object({
  title: z.string().max(300),
  url: z.string().url().max(2000),
});

export const WebSearchResultDtoSchema = z.object({
  summary: z.string().max(200),
  sources: z.array(WebSearchSourceSchema).max(5),
});

export const ToolCallDtoSchema = z.object({
  name: z.literal('tavily_search'),
  query: z.string().max(500),
  summary: z.string().max(200),
});

// chat_messages.tool_calls / .sources jsonb columns validate against these.
export const ChatToolCallsSchema = z.array(ToolCallDtoSchema).nullable();
export const ChatSourcesSchema = z.array(WebSearchSourceSchema).nullable();

// Adapter-internal raw-response schema (NOT domain-facing) — used only
// inside `TavilySearchAdapter` to validate the untrusted HTTP response
// before any of it is summarized.
export const TavilySearchResultRowSchema = z.object({
  title: z.string().max(300),
  url: z.string().url().max(2000),
  content: z.string().max(5000),
  score: z.number().optional(),
});

export const TavilySearchResponseRowSchema = z.object({
  query: z.string(),
  results: z.array(TavilySearchResultRowSchema),
  response_time: z.number().optional(),
});

export type ChatRole = z.infer<typeof ChatRoleSchema>;
export type ChatMessageRowDto = z.infer<typeof ChatMessageRowSchema>;
export type ChatMessageRequestDto = z.infer<typeof ChatMessageRequestSchema>;
export type ChatMessageWireDto = z.infer<typeof ChatMessageWireSchema>;
export type ChatTurnResponseDto = z.infer<typeof ChatTurnResponseSchema>;
export type ChatHistoryResponseDto = z.infer<typeof ChatHistoryResponseSchema>;
export type RedactedQuestionDto = z.infer<typeof RedactedQuestionSchema>;
export type WebSearchSourceDto = z.infer<typeof WebSearchSourceSchema>;
export type WebSearchResultDto = z.infer<typeof WebSearchResultDtoSchema>;
export type ToolCallDto = z.infer<typeof ToolCallDtoSchema>;
export type TavilySearchResultRowDto = z.infer<typeof TavilySearchResultRowSchema>;
export type TavilySearchResponseRowDto = z.infer<typeof TavilySearchResponseRowSchema>;
