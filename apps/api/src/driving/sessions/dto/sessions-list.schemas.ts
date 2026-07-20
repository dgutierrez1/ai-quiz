// apps/api/src/driving/sessions/dto/sessions-list.schemas.ts
//
// Story 5.1 — GET /api/sessions (list) request/response schemas.
//
// NOT added to `packages/shared/src/schemas.ts` — that file is owned by a
// concurrently-running agent for this iteration (adding migrations
// 0005+/shared DTOs). Defined locally instead, mirroring the precedent
// Story 3.1 set with `domain/submission/dto/submission.schemas.ts` for the
// exact same reason. Flagged for promotion to `packages/shared` in a
// follow-up once the concurrent slice lands.
//
// AD-3 "row ≠ wire" split: the repository (`quiz-session.repository.ts`)
// returns full `QuizSessionRowDto` rows; `SessionSummarySchema` here is the
// deliberately minimal outbound projection — source URL, status, created
// date only, per the literal epics.md AC. The controller performs the
// row -> wire projection; the repository never builds the wire shape
// directly.

import { z } from 'zod';

export const SessionSummarySchema = z
  .object({
    id: z.string().uuid(),
    sourceUrl: z.string().url(),
    status: z.enum(['pending', 'ready', 'submitted', 'failed']),
    createdAt: z.date(),
  })
  .strict();

// Inbound wire (query string). `before` is the `createdAt` of the last row
// from the previous page (exclusive cursor) — same idiom as Story 4.1's
// `findRecentForUser(sessionId, userId, before?: Date)` chat pagination.
export const ListSessionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.string().datetime().optional(),
  })
  .strict();

// Outbound wire — mirrors Story 4.1's `ChatHistoryResponseSchema` shape
// (`{messages, hasMore}`) intentionally, for consistency across the app's
// two "recent items + load more" surfaces.
export const SessionsListResponseSchema = z
  .object({
    sessions: z.array(SessionSummarySchema),
    hasMore: z.boolean(),
  })
  .strict();

export type SessionSummaryDto = z.infer<typeof SessionSummarySchema>;
export type ListSessionsQueryDto = z.infer<typeof ListSessionsQuerySchema>;
export type SessionsListResponseDto = z.infer<typeof SessionsListResponseSchema>;
