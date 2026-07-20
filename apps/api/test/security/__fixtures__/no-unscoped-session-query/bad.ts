// Story 5.3 Task 5 — KNOWN-BAD fixture for `@ai-quiz/no-unscoped-session-query`.
//
// AGENTS.md / project-context.md describe this rule as mandatory: it
// "catches `WHERE session_id = ?` outside a `forUser*` context or without
// an explicit `assertUserOwns(sessionId, userId)` call." This file is
// exactly that shape — a raw `session_id`-scoped query with NO
// accompanying ownership check and NOT wrapped in a `forUser*`-named
// function.
//
// See `lint-rule-cli-enforcement.security.test.ts`'s header comment for
// this rule's history — it did not exist when this fixture was first
// written (a real Story 1.4 gap) and has since landed.

import { sql } from 'drizzle-orm';

export function loadAnswersUnscoped(sessionId: string): unknown {
  return sql`SELECT * FROM answers WHERE session_id = ${sessionId}`;
}
