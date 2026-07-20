import { randomUUID } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import { lastValueFrom, Observable } from 'rxjs';

import { DATABASE_TOKEN, type DatabaseState } from '../../adapters/persistence/drizzle/client.js';
import { users } from '../../adapters/persistence/drizzle/schema.js';
import type { InternalUserId } from '../../domain/ports/user-repository.port.js';
import { requestContext } from './request-context.js';

@Injectable()
export class IdentityInterceptor implements NestInterceptor {
  public constructor(@Inject(DATABASE_TOKEN) private readonly state: DatabaseState) {}
  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { id?: string }>();
    const externalId = request.header('x-user-id')!;
    request.id ||= randomUUID();
    return new Observable((subscriber) => {
      void this.state.db
        .transaction(async (tx) => {
          const rows = await tx
            .insert(users)
            .values({ externalId })
            .onConflictDoUpdate({ target: users.externalId, set: { externalId } })
            .returning();
          const user = rows[0];
          if (!user) throw new Error('identity upsert returned no user');
          const userId = user.id as InternalUserId;
          await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
          return requestContext.run(
            { tx: tx as typeof this.state.db, userId, requestId: request.id! },
            () => lastValueFrom(next.handle()),
          );
        })
        .then((value) => {
          subscriber.next(value);
          subscriber.complete();
        })
        .catch((error: unknown) => subscriber.error(error));
    });
  }
}
