// apps/api/src/domain/chat/ports/chat-retention.port.ts
//
// Story 4.4 Task 2. Pure interface — no I/O imports (AD-2).

export interface ChatRetentionPort {
  /**
   * All internal `users.id` values. `users` is explicitly NOT RLS-governed
   * (AD-9), so this read needs no GUC. Kept on this port (rather than
   * extending the shared `UserRepositoryPort`, which this story does not
   * own) to avoid a cross-boundary edit to a file another concurrent
   * iteration owns.
   */
  listAllUserIds(): Promise<readonly string[]>;

  /**
   * Nulls `content`/`sources`/`toolCalls`/`thinking` and sets `scrubbedAt`
   * on every one user's `chat_messages` rows with `createdAt < cutoff` and
   * `scrubbedAt IS NULL`. Scoped to exactly one user per call so the adapter
   * can open its own transaction and set its own `app.user_id` GUC (AD-9) —
   * no BYPASSRLS, no second connection pool, no superuser role.
   */
  scrubUserChatContent(userId: string, cutoff: Date): Promise<{ readonly scrubbedCount: number }>;
}
