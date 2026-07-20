import { AsyncLocalStorage } from 'node:async_hooks';

import type { DrizzleDatabase } from '../../adapters/persistence/drizzle/client.js';
import type { InternalUserId } from '../../domain/ports/user-repository.port.js';

export type RequestContext = { tx: DrizzleDatabase; userId: InternalUserId; requestId: string };
export const requestContext = new AsyncLocalStorage<RequestContext>();
export function getRequestContext(): RequestContext {
  const value = requestContext.getStore();
  if (!value) throw new Error('Request context unavailable');
  return value;
}
