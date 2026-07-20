import { Module } from '@nestjs/common';

import { ObservabilityModule } from '../../adapters/observability/observability.module.js';
import { ChatRetentionRepository } from '../../adapters/persistence/drizzle/chat-retention.repo.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceAuthGuard } from './maintenance-auth.guard.js';

// Story 4.4 Task 6 — this route carries no `X-User-Id` and is not
// session-scoped, so it is deliberately NOT wired through
// `user-id.middleware`/`IdentityInterceptor`/`@OwnsSession()`. See this
// story's completion notes: `user-id.middleware.ts`'s `PUBLIC_PATHS` allowlist
// (or `AppModule`'s `UserIdMiddleware` route configuration) must exclude
// `/api/maintenance/scrub-chat`, or every call 400s before reaching
// `MaintenanceAuthGuard` — flagged for the orchestrator registering this
// module, since both of those files are outside this story's ownership.
@Module({
  imports: [ObservabilityModule],
  controllers: [MaintenanceController],
  providers: [ChatRetentionRepository, MaintenanceAuthGuard],
})
export class MaintenanceModule {}
