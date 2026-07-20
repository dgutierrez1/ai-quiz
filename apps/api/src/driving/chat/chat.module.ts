import { Module } from '@nestjs/common';

import { ObservabilityModule } from '../../adapters/observability/observability.module.js';
import { ChatRepository } from '../../adapters/persistence/drizzle/chat.repository.js';
import { QuizSessionRepository } from '../../adapters/persistence/drizzle/quiz-session.repository.js';
import { SubmissionRepository } from '../../adapters/persistence/drizzle/submission.repository.js';
import { IdentityInterceptor } from '../middleware/identity.interceptor.js';
import { OwnSessionInterceptor } from '../middleware/own-session.interceptor.js';
import { ChatController } from './chat.controller.js';

@Module({
  imports: [ObservabilityModule],
  controllers: [ChatController],
  providers: [
    QuizSessionRepository,
    SubmissionRepository,
    ChatRepository,
    IdentityInterceptor,
    OwnSessionInterceptor,
  ],
})
export class ChatModule {}
