import { createHash } from 'node:crypto';

import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnvironment } from '../../config/env.js';
import { TRACING_PORT, type TracingPort } from '../../domain/ports/tracing.port.js';
import { LangfuseAdapter } from './langfuse.adapter.js';
import { NoopTracingAdapter } from './noop-tracing.adapter.js';

/**
 * Hash an internal users.id for trace attribution.
 *
 * Logs and traces carry `user_id_hash`, never the raw identifier (NFR-3,
 * constitution rule 9). Exported so use-cases share one definition rather than
 * each inventing its own hashing.
 */
export function hashUserId(userId: string): string {
  return createHash('sha256').update(userId, 'utf8').digest('hex');
}

/**
 * Binds `TracingPort` to Langfuse when credentials are configured, and to the
 * no-op adapter otherwise (default-deny: absent keys mean absent tracing, not a
 * boot failure). Global so any use-case can inject it without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: TRACING_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment, true>): TracingPort => {
        const publicKey = config.get<string>('LANGFUSE_PUBLIC_KEY' as never);
        const secretKey = config.get<string>('LANGFUSE_SECRET_KEY' as never);
        const baseUrl =
          config.get<string>('LANGFUSE_BASE_URL' as never) ?? 'https://cloud.langfuse.com';

        if (
          typeof publicKey === 'string' &&
          publicKey.length > 0 &&
          typeof secretKey === 'string' &&
          secretKey.length > 0
        ) {
          return new LangfuseAdapter({ publicKey, secretKey, baseUrl });
        }
        return new NoopTracingAdapter();
      },
    },
  ],
  exports: [TRACING_PORT],
})
export class ObservabilityModule {}
