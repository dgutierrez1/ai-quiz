import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
// Story 5.3 AC #9 / Task 4 — reads Fly's own edge-set `Fly-Client-IP` header,
// never `X-Forwarded-For` (client-spoofable) and never Express `trust proxy`
// (a hop-count guess that's easy to get wrong for the actual topology). See
// Dev Notes → "Trusted-proxy resolution" in
// _bmad-output/implementation-artifacts/5-3-cross-user-isolation-e2e-security-sweep.md
// for the full reasoning. Falls back to the raw socket address only when the
// header is absent (local dev / CI / non-Fly environments).
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req.headers as Record<string, string | undefined>;
    const flyClientIp = headers['fly-client-ip'];
    if (flyClientIp) return flyClientIp;
    const socket = req.socket as { remoteAddress?: string } | undefined;
    return socket?.remoteAddress ?? 'unknown';
  }
  protected override generateKey(
    context: Parameters<ThrottlerGuard['generateKey']>[0],
    suffix: string,
    name: string,
  ): string {
    return `ip:${super.generateKey(context, suffix, name)}`;
  }
}
