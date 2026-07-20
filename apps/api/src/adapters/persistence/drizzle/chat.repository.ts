// apps/api/src/adapters/persistence/drizzle/chat.repository.ts
//
// Story 4.1 Task 7. `findRecentForUser` rides the caller's request
// transaction (`getRequestContext().tx`), same as every other repository in
// this codebase. Method names are `*ForUser` (per `@ai-quiz/no-unscoped-session-query`
// — Story 1.4's lint rule).

import { and, desc, eq, lt } from 'drizzle-orm';

import {
  type ChatMessageRowDto,
  ChatMessageRowSchema,
} from '../../../domain/chat/dto/chat.schemas.js';
import type {
  ChatAssistantTurnInput,
  ChatHistoryPage,
  ChatRepositoryPort,
} from '../../../domain/chat/ports/chat-repository.port.js';
import type { InternalUserId } from '../../../domain/ports/user-repository.port.js';
import { getRequestContext } from '../../../driving/middleware/request-context.js';
import { chatMessages, quizSessions } from './schema.js';

const PAGE_SIZE = 50;

function toRowDto(row: typeof chatMessages.$inferSelect): ChatMessageRowDto {
  return Object.freeze(
    ChatMessageRowSchema.parse({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role,
      content: row.content,
      sources: row.sources,
      toolCalls: row.toolCalls,
      model: row.model,
      thinking: row.thinking,
      scrubbedAt: row.scrubbedAt,
      createdAt: row.createdAt,
    }),
  );
}

export class ChatRepository implements ChatRepositoryPort {
  public async appendTurn(
    sessionId: string,
    userId: InternalUserId,
    userContent: string,
    assistant: ChatAssistantTurnInput,
  ): Promise<{
    readonly userMessage: ChatMessageRowDto;
    readonly assistantMessage: ChatMessageRowDto;
  }> {
    const tx = getRequestContext().tx;
    // Ownership is already enforced by `@OwnsSession()` upstream and by RLS
    // at the database layer (depth-1 EXISTS-join through quiz_sessions); this
    // repository still scopes every write through the owned session id, per
    // the `forUser*` convention `@ai-quiz/no-unscoped-session-query` expects.
    const owned = await tx
      .select({ id: quizSessions.id })
      .from(quizSessions)
      .where(and(eq(quizSessions.id, sessionId), eq(quizSessions.userId, userId)))
      .limit(1);
    if (!owned[0]) throw new Error(`chat.repository: session ${sessionId} not owned by caller`);

    const [userRow] = await tx
      .insert(chatMessages)
      .values({ sessionId, role: 'user', content: userContent })
      .returning();
    if (!userRow) throw new Error('chat.repository: user message insert returned no row');

    const [assistantRow] = await tx
      .insert(chatMessages)
      .values({
        sessionId,
        role: 'assistant',
        content: assistant.content,
        sources: assistant.sources,
        toolCalls: assistant.toolCalls,
        model: assistant.model,
        thinking: assistant.thinking,
      })
      .returning();
    if (!assistantRow) throw new Error('chat.repository: assistant message insert returned no row');

    return { userMessage: toRowDto(userRow), assistantMessage: toRowDto(assistantRow) };
  }

  public async findRecentForUser(
    sessionId: string,
    userId: InternalUserId,
    before?: Date,
  ): Promise<ChatHistoryPage> {
    const tx = getRequestContext().tx;
    const owned = await tx
      .select({ id: quizSessions.id })
      .from(quizSessions)
      .where(and(eq(quizSessions.id, sessionId), eq(quizSessions.userId, userId)))
      .limit(1);
    if (!owned[0]) return { messages: [], hasMore: false };

    // Keyset (seek) pagination — NEVER LIMIT/OFFSET (Story 4.1 AC #7). The
    // wire cursor is a bare `createdAt` timestamp (see the port's doc
    // comment for why the FE never sends an id). A STRICT `created_at <
    // before` comparison — never `<=` — is what makes the tie-break safe:
    // one turn's user+assistant rows routinely share an identical `now()`
    // (stable for the lifetime of a transaction), so excluding the entire
    // boundary INSTANT rather than trying to split it by id guarantees
    // neither tied row is ever re-delivered on the next page. (An
    // id-based tiebreak was tried and rejected here — resolving the
    // boundary id via `MAX(id) WHERE created_at = before` and comparing
    // `id < boundaryId` still let the smaller-id member of the tie pair
    // leak back into the "older" page, since IT has an id smaller than
    // the boundary. Excluding the whole instant is simpler and correct.)
    const whereClause = before
      ? and(eq(chatMessages.sessionId, sessionId), lt(chatMessages.createdAt, before))
      : eq(chatMessages.sessionId, sessionId);

    const rows = await tx
      .select()
      .from(chatMessages)
      .where(whereClause)
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    // Reverse to chronological order for the caller.
    const chronological = [...page].reverse();

    return { messages: chronological.map(toRowDto), hasMore };
  }
}
