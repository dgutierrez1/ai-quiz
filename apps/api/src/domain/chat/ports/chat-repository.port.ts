// apps/api/src/domain/chat/ports/chat-repository.port.ts
//
// Story 4.1 Task 2. Pure interface — no `@nestjs/*`, `drizzle-orm`,
// `undici`, `node:fetch` (AD-2).

import type { InternalUserId } from '../../ports/user-repository.port.js';
import type { ChatMessageRowDto } from '../dto/chat.schemas.js';

export interface ChatAssistantTurnInput {
  readonly content: string | null;
  readonly sources: unknown;
  readonly toolCalls: unknown;
  readonly model: string | null;
  readonly thinking: unknown;
}

export interface ChatHistoryPage {
  readonly messages: readonly ChatMessageRowDto[];
  readonly hasMore: boolean;
}

export interface ChatRepositoryPort {
  /**
   * Persists both the user turn and the assistant turn for one chat
   * exchange, scoped to the caller-owned session. Returns both rows.
   */
  appendTurn(
    sessionId: string,
    userId: InternalUserId,
    userContent: string,
    assistant: ChatAssistantTurnInput,
  ): Promise<{
    readonly userMessage: ChatMessageRowDto;
    readonly assistantMessage: ChatMessageRowDto;
  }>;

  /**
   * Keyset (seek) pagination — never LIMIT/OFFSET (Story 4.1 AC #7). No
   * `before`: latest 50, chronological order, newest-first internally then
   * reversed. With `before` (the wire cursor is a bare ISO timestamp — the
   * FE only ever remembers `createdAt`, never an id): every message
   * strictly before that timestamp.
   *
   * The comparison is STRICT `created_at < before` — never `<=`. This
   * matters in practice, not just in theory: `appendTurn` inserts the user
   * and assistant rows for one turn in a single transaction, and Postgres's
   * `now()` is stable for the lifetime of a transaction — so both rows of a
   * turn routinely share an IDENTICAL `created_at`. Excluding the whole
   * boundary instant (rather than trying to split it with an id tiebreak)
   * guarantees neither tied row is ever re-delivered on the next page — see
   * `chat.repository.ts` for the id-tiebreak approach that was tried and
   * rejected.
   */
  findRecentForUser(
    sessionId: string,
    userId: InternalUserId,
    before?: Date,
  ): Promise<ChatHistoryPage>;
}
