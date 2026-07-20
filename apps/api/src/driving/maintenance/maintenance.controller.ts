import { Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { ChatRetentionRepository } from '../../adapters/persistence/drizzle/chat-retention.repo.js';
import { scrubChatContent } from '../../domain/chat/use-cases/scrub-chat-content.use-case.js';
import { TRACING_PORT, type TracingPort } from '../../domain/ports/tracing.port.js';
import { MaintenanceAuthGuard } from './maintenance-auth.guard.js';

@Controller('maintenance')
export class MaintenanceController {
  public constructor(
    private readonly retention: ChatRetentionRepository,
    @Inject(TRACING_PORT) private readonly tracing: TracingPort,
  ) {}

  // Story 4.4 AC #3/#7/#11 — authenticated, idempotent maintenance route
  // driven by the same external cron already required for the /healthz
  // keep-warm ping. @SkipThrottle() mirrors /healthz's Story 1.5 rationale:
  // this route is protected by a shared secret, not the per-user/per-IP
  // throttle model, and the GH Actions runner's rotating IP must not trip it.
  @Post('scrub-chat')
  @HttpCode(200)
  @UseGuards(MaintenanceAuthGuard)
  @SkipThrottle()
  public async scrubChat(): Promise<unknown> {
    return scrubChatContent({ retention: this.retention, tracing: this.tracing });
  }
}
