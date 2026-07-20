import { applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
export const RATE_LIMITS = Object.freeze({
  GLOBAL: { ttl: 60_000, limit: 30 },
  CREATE_SESSION: { ttl: 60_000, limit: 5 },
  CHAT: { ttl: 60_000, limit: 20 },
});
export const ThrottleCreateSession = (): MethodDecorator =>
  applyDecorators(Throttle({ global: RATE_LIMITS.CREATE_SESSION }));
export const ThrottleChat = (): MethodDecorator =>
  applyDecorators(Throttle({ global: RATE_LIMITS.CHAT }));
