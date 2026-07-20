// KNOWN-BAD fixture for `@ai-quiz/local/no-unscoped-session-query` (Story 1.4).
//
// Every function below filters on a session id WITHOUT establishing ownership:
// the name does not start with `forUser`, there is no `assertUserOwns(...)`
// call, and there is no `user_id` filter. Each MUST be reported.
//
// This directory is in `globalIgnores`, so verify explicitly:
//   pnpm exec eslint apps/api/test/fixtures/lint-guard/session-scope-bad.ts --no-ignore
// Expected: exit 1, one report per function below.

declare const db: {
  select: () => {
    from: (t: unknown) => { where: (c: unknown) => Promise<unknown[]> };
  };
};
declare const chatMessages: { sessionId: string; id: string };
declare function eq(left: unknown, right: unknown): unknown;
declare function sql(strings: TemplateStringsArray, ...values: unknown[]): unknown;

// BAD: reads a session's child rows with no ownership context at all.
export async function loadMessages(sessionId: string): Promise<unknown[]> {
  return db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId));
}

// BAD: raw SQL is the case Postgres RLS also cannot rescue, so the lint layer
// is the only dev-time guard that sees it.
export function rawSessionQuery(sessionId: string): unknown {
  return sql`SELECT * FROM chat_messages WHERE session_id = ${sessionId}`;
}
