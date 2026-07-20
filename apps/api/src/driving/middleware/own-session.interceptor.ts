import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';

import { QuizSessionRepository } from '../../adapters/persistence/drizzle/quiz-session.repository.js';
import { NotFoundError } from '../../domain/quiz/errors/not-found.error.js';
import { getRequestContext } from './request-context.js';
export const OWNS_SESSION = 'owns-session';

/**
 * A malformed `:id` must never reach Postgres.
 *
 * `quiz_sessions.id` is a `uuid` column, so handing it `not-a-valid-uuid`
 * raises a driver-level error -> 500. That is wrong twice over: it is a 500
 * where the contract says 404, and the resulting error message embeds the
 * bind parameters (including the internal `users.id`) in the log stream.
 * Rejecting the shape here keeps both problems from ever arising, and returns
 * the same 404 as not-found/not-owned so nothing about existence leaks.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class OwnSessionInterceptor implements NestInterceptor {
  public constructor(private readonly sessions: QuizSessionRepository) {}
  public async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const id = String(request.params.id);
    if (!UUID_RE.test(id)) throw new NotFoundError();
    const session = await this.sessions.findByIdAndUserId(id, getRequestContext().userId);
    if (!session) throw new NotFoundError();
    return next.handle();
  }
}
export function OwnsSession(): MethodDecorator {
  return applyDecorators(SetMetadata(OWNS_SESSION, true), UseInterceptors(OwnSessionInterceptor));
}
