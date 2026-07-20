import { UserRowSchema } from '@ai-quiz/shared';

import type { UserRepositoryPort } from '../../../domain/ports/user-repository.port.js';
import { getRequestContext } from '../../../driving/middleware/request-context.js';
import { users } from './schema.js';
export class UserRepository implements UserRepositoryPort {
  public async upsertByExternalId(externalId: string) {
    const rows = await getRequestContext()
      .tx.insert(users)
      .values({ externalId })
      .onConflictDoUpdate({ target: users.externalId, set: { externalId } })
      .returning();
    return Object.freeze(UserRowSchema.parse(rows[0]));
  }
}
