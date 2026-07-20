import { UserIdHeaderSchema } from '@ai-quiz/shared';
import { BadRequestException, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// Story 4.4 addition: /api/maintenance/scrub-chat carries no X-User-Id (it's
// a system-scoped route, authenticated by X-Maintenance-Token instead — see
// maintenance-auth.guard.ts) and must not 400 here before reaching that
// guard.
const PUBLIC_PATHS = new Set([
  '/healthz',
  '/api/health',
  '/api/config/providers',
  '/api/maintenance/scrub-chat',
]);

@Injectable()
export class UserIdMiddleware implements NestMiddleware {
  public use(request: Request, _response: Response, next: NextFunction): void {
    // Express route mounting makes `request.path` and `request.url` always
    // relative to the mounted middleware path; use `originalUrl` to see the
    // full request URL.
    const pathOnly = (request.originalUrl ?? '/').split('?')[0] ?? '/';
    if (PUBLIC_PATHS.has(pathOnly)) {
      next();
      return;
    }
    const parsed = UserIdHeaderSchema.safeParse(request.header('x-user-id'));
    if (!parsed.success) throw new BadRequestException('X-User-Id must be a UUID v4');
    next();
  }
}
