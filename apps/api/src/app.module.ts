import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { AdaptersModule } from './adapters/adapters.module.js';
import { ObservabilityModule } from './adapters/observability/observability.module.js';
import { DatabaseModule } from './adapters/persistence/drizzle/database.module.js';
import { validateEnv } from './config/env.js';
import { ChatModule } from './driving/chat/chat.module.js';
import { HealthModule } from './driving/health/health.module.js';
import { MaintenanceModule } from './driving/maintenance/maintenance.module.js';
import { IpThrottlerGuard } from './driving/middleware/ip-throttler.guard.js';
import { SafeExceptionFilter } from './driving/middleware/safe-exception.filter.js';
import { RATE_LIMITS } from './driving/middleware/throttler.config.js';
import { UserIdMiddleware } from './driving/middleware/user-id.middleware.js';
import { UserThrottlerGuard } from './driving/middleware/user-throttler.guard.js';
import { ProvidersModule } from './driving/providers/providers.module.js';
import { SessionsModule } from './driving/sessions/sessions.module.js';
import { SubmissionsModule } from './driving/submissions/submissions.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ name: 'global', ...RATE_LIMITS.GLOBAL }]),
    DatabaseModule,
    // NFR-3: binds TracingPort to Langfuse when credentials exist, no-op otherwise.
    ObservabilityModule,
    // Composition root for the driven adapters (LLM, ingestion, web search,
    // enrichment). Global, so it must sit above the driving modules that
    // inject those ports.
    AdaptersModule,
    HealthModule,
    ProvidersModule,
    SessionsModule,
    SubmissionsModule,
    // Stories 4.1/4.2: per-session chat thread with the pre-submit answer-exfil
    // guard and the bounded Tavily tool loop.
    ChatModule,
    // Story 4.4: token-guarded 7-day chat-content scrub, driven by the same
    // external cron that keeps the machine warm.
    MaintenanceModule,
    // AD-7/AD-8: every module above must stay ABOVE any future
    // `MastraModule.register()` — Mastra ships a catch-all `@All('*')`
    // controller that shadows every route unless it is imported last.
  ],
  providers: [
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useClass: IpThrottlerGuard },
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(UserIdMiddleware).forRoutes('*');
  }
}
