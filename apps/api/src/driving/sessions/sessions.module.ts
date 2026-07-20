import { Module } from '@nestjs/common';

import { QuizPersistenceRepository } from '../../adapters/persistence/drizzle/quiz-persistence.repository.js';
import { QuizSessionRepository } from '../../adapters/persistence/drizzle/quiz-session.repository.js';
import { SubmissionRepository } from '../../adapters/persistence/drizzle/submission.repository.js';
import { IdentityInterceptor } from '../middleware/identity.interceptor.js';
import { OwnSessionInterceptor } from '../middleware/own-session.interceptor.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  controllers: [SessionsController],
  providers: [
    QuizSessionRepository,
    QuizPersistenceRepository,
    SubmissionRepository,
    IdentityInterceptor,
    OwnSessionInterceptor,
  ],
  exports: [QuizSessionRepository, QuizPersistenceRepository],
})
export class SessionsModule {}
