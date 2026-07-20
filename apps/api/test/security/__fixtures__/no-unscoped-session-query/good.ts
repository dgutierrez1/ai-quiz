// Story 5.3 Task 5 — KNOWN-GOOD fixture for `@ai-quiz/no-unscoped-session-query`.
//
// Same query shape as `bad.ts`, but wrapped in a `forUser*`-named function
// that also calls `assertUserOwns(sessionId, userId)` first — the safe
// pattern the rule requires (see `bad.ts`'s header comment for its
// history). This file must always pass lint, rule implemented or not, so
// it is a stable "does the good path stay green" control.

import { sql } from 'drizzle-orm';

function assertUserOwns(_sessionId: string, _userId: string): void {
  // Real implementation lives in the four-layer ownership pattern
  // (`own-session.interceptor.ts` + each use-case's
  // `findByIdAndUserId` call) — this fixture only needs the shape.
}

export function forUserLoadAnswers(sessionId: string, userId: string): unknown {
  assertUserOwns(sessionId, userId);
  return sql`SELECT * FROM answers WHERE session_id = ${sessionId}`;
}
