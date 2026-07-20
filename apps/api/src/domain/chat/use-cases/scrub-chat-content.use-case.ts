// apps/api/src/domain/chat/use-cases/scrub-chat-content.use-case.ts
//
// Story 4.4 Task 3. Plain exported function (see chat.use-case.ts's doc
// comment for the domain-purity rationale this repo-wide convention follows).

import type { ChatRetentionPort } from '../ports/chat-retention.port.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface ChatRetentionTracingPort {
  deleteTracesOlderThan(cutoff: Date): Promise<{ readonly deletedCount: number }>;
}

export interface ScrubChatContentDeps {
  readonly retention: ChatRetentionPort;
  readonly tracing?: ChatRetentionTracingPort;
}

export interface ScrubChatContentResult {
  readonly chatRowsScrubbed: number;
  readonly langfuseTracesDeleted: number;
  readonly cutoff: string;
  /** Count of users whose per-user scrub transaction failed; logged upstream, never blocks the rest. */
  readonly failedUserCount: number;
}

/**
 * Cross-user 7-day scrub (AC #1/#6/#8/#12). `cutoff` defaults to
 * `now - 7 days`; the predicate `created_at < cutoff AND scrubbed_at IS NULL`
 * (owned by the adapter, Task 4) is what makes every run naturally
 * idempotent — a second run over the same window scrubs 0 rows, with no
 * run-log table needed.
 *
 * A single user's scrub failure is caught and counted, never allowed to
 * abort the loop over the remaining users (Task 3's explicit requirement).
 */
export async function scrubChatContent(
  deps: ScrubChatContentDeps,
  now: Date = new Date(),
): Promise<ScrubChatContentResult> {
  const cutoff = new Date(now.getTime() - SEVEN_DAYS_MS);
  const userIds = await deps.retention.listAllUserIds();

  let chatRowsScrubbed = 0;
  let failedUserCount = 0;

  for (const userId of userIds) {
    try {
      const { scrubbedCount } = await deps.retention.scrubUserChatContent(userId, cutoff);
      chatRowsScrubbed += scrubbedCount;
    } catch {
      failedUserCount += 1;
    }
  }

  let langfuseTracesDeleted = 0;
  if (deps.tracing) {
    try {
      const result = await deps.tracing.deleteTracesOlderThan(cutoff);
      langfuseTracesDeleted = result.deletedCount;
    } catch {
      // TracingPort implementations must not throw (AD-N9), but this call
      // stays defensive regardless — Langfuse retention is best-effort and
      // must never fail the Postgres-side scrub that already succeeded.
      langfuseTracesDeleted = 0;
    }
  }

  return Object.freeze({
    chatRowsScrubbed,
    langfuseTracesDeleted,
    cutoff: cutoff.toISOString(),
    failedUserCount,
  });
}
