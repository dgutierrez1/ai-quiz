// apps/api/src/adapters/persistence/drizzle/chat-retention.repo.ts
//
// Story 4.4 Task 4 — cross-user scrub, one connection + one transaction per
// user, each with its own `app.user_id` GUC (AD-9). Deliberately mirrors
// `quiz-persistence.repository.ts#markSessionFailed`'s "own connection, own
// transaction, own GUC" pattern rather than reusing the request-scoped
// `getRequestContext().tx` — this job runs from a cron-triggered maintenance
// route with no per-request identity/transaction to ride.
//
// NO BYPASSRLS, no second connection pool, no superuser role (Story 4.4
// Design ruling) — `chat_messages`'s existing Story 4.1 RLS policy already
// scopes the UPDATE to the GUC'd user's rows; no extra join is needed in the
// query text.

import { Inject, Injectable } from '@nestjs/common';

import type { ChatRetentionPort } from '../../../domain/chat/ports/chat-retention.port.js';
import { DATABASE_TOKEN, type DatabaseState } from './client.js';

@Injectable()
export class ChatRetentionRepository implements ChatRetentionPort {
  public constructor(@Inject(DATABASE_TOKEN) private readonly state: DatabaseState) {}

  /** `users` is explicitly NOT RLS-governed (AD-9) — no GUC needed for this read. */
  public async listAllUserIds(): Promise<readonly string[]> {
    const result = await this.state.pool.query<{ id: string }>('SELECT id FROM users');
    return result.rows.map((row) => row.id);
  }

  public async scrubUserChatContent(
    userId: string,
    cutoff: Date,
  ): Promise<{ readonly scrubbedCount: number }> {
    const client = await this.state.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const result = await client.query(
        `UPDATE chat_messages
           SET content = NULL, sources = NULL, tool_calls = NULL, thinking = NULL, scrubbed_at = now()
         WHERE created_at < $1
           AND scrubbed_at IS NULL
         RETURNING id`,
        [cutoff],
      );
      await client.query('COMMIT');
      return { scrubbedCount: result.rowCount ?? 0 };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
