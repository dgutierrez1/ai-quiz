// KNOWN-GOOD fixture for `@ai-quiz/local/no-unscoped-session-query` (Story 1.4).
//
// Each function below filters on a session id but ALSO establishes ownership,
// via one of the three sanctioned escapes. None may be reported.
//
//   pnpm exec eslint apps/api/test/fixtures/lint-guard/session-scope-good.ts --no-ignore
// Expected: exit 0.

declare const db: {
  select: () => {
    from: (t: unknown) => { where: (c: unknown) => Promise<unknown[]> };
  };
};
declare const chatMessages: { sessionId: string; id: string };
declare const quizSessions: { id: string; userId: string };
declare function eq(left: unknown, right: unknown): unknown;
declare function and(...conditions: unknown[]): unknown;
declare function sql(strings: TemplateStringsArray, ...values: unknown[]): unknown;
declare function assertUserOwns(sessionId: string, userId: string): void;

// GOOD (escape 1): the `forUser*` naming convention marks the ownership contract
// in the signature itself, so every call site reads as user-scoped.
export async function forUserSessionMessages(sessionId: string): Promise<unknown[]> {
  return db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId));
}

// GOOD (escape 2): an explicit ownership assertion in the same function.
export async function loadMessagesChecked(sessionId: string, userId: string): Promise<unknown[]> {
  assertUserOwns(sessionId, userId);
  return db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId));
}

// GOOD (escape 3): the query is already scoped by the owning user, so it is by
// definition not unscoped.
export async function loadSessionForOwner(sessionId: string, userId: string): Promise<unknown[]> {
  return db
    .select()
    .from(quizSessions)
    .where(and(eq(quizSessions.id, sessionId), eq(quizSessions.userId, userId)));
}

// GOOD: raw SQL that carries the user filter alongside the session filter.
export function rawScopedQuery(sessionId: string, userId: string): unknown {
  return sql`SELECT m.* FROM chat_messages m
             JOIN quiz_sessions s ON s.id = m.session_id
             WHERE m.session_id = ${sessionId} AND s.user_id = ${userId}`;
}
