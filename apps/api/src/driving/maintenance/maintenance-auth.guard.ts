// Story 4.4 Task 6 — compares SHA-256 digests of the supplied
// `X-Maintenance-Token` header and `process.env.MAINTENANCE_TOKEN` via
// `crypto.timingSafeEqual`. Hashing first fixes both buffers at 32 bytes,
// which avoids `timingSafeEqual`'s length-mismatch throw and keeps the
// comparison constant-time even when the header is absent or the wrong
// length. Missing header, unconfigured token, or mismatch => 401 — this is a
// system route, not a per-session route, so the "404 never 403" ownership
// convention does not apply here (401 is correct, per AC #7).

import { createHash, timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class MaintenanceAuthGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-maintenance-token') ?? '';
    const expected = process.env.MAINTENANCE_TOKEN ?? '';

    // An unconfigured server-side token must never match an absent/empty
    // header — both would otherwise hash identically.
    const matches = expected.length > 0 && timingSafeEqual(sha256(provided), sha256(expected));
    if (!matches) throw new UnauthorizedException('invalid or missing X-Maintenance-Token');
    return true;
  }
}
