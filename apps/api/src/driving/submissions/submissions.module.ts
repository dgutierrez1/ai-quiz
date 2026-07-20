import { Module } from '@nestjs/common';

import { QuizSessionRepository } from '../../adapters/persistence/drizzle/quiz-session.repository.js';
import { SubmissionRepository } from '../../adapters/persistence/drizzle/submission.repository.js';
import { IdentityInterceptor } from '../middleware/identity.interceptor.js';
import { OwnSessionInterceptor } from '../middleware/own-session.interceptor.js';
import { SubmissionsController } from './submissions.controller.js';

@Module({
  controllers: [SubmissionsController],
  providers: [
    QuizSessionRepository,
    SubmissionRepository,
    IdentityInterceptor,
    OwnSessionInterceptor,
  ],
})
export class SubmissionsModule {}
