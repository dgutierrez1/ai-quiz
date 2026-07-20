import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req.headers as Record<string, string | undefined>;
    return headers['x-user-id'] ?? String(req.ip ?? 'anonymous');
  }
  protected override generateKey(
    context: Parameters<ThrottlerGuard['generateKey']>[0],
    suffix: string,
    name: string,
  ): string {
    return `user:${super.generateKey(context, suffix, name)}`;
  }
}
