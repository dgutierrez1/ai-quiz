import { Body, Controller, HttpCode, Param, Post, UseInterceptors } from '@nestjs/common';

import { QuizSessionRepository } from '../../adapters/persistence/drizzle/quiz-session.repository.js';
import { SubmissionRepository } from '../../adapters/persistence/drizzle/submission.repository.js';
import {
  type SubmitRequestDto,
  SubmitRequestSchema,
  SubmitResponseSchema,
} from '../../domain/submission/dto/submission.schemas.js';
import { submitAnswers } from '../../domain/submission/use-cases/submit-answers.use-case.js';
import { IdentityInterceptor } from '../middleware/identity.interceptor.js';
import { OwnsSession } from '../middleware/own-session.interceptor.js';
import { getRequestContext } from '../middleware/request-context.js';
import { ZodValidationPipe } from '../sessions/zod-validation.pipe.js';

@Controller('sessions')
@UseInterceptors(IdentityInterceptor)
export class SubmissionsController {
  public constructor(
    private readonly quizRepo: QuizSessionRepository,
    private readonly submissionRepo: SubmissionRepository,
  ) {}

  @Post(':id/submit')
  @HttpCode(200)
  @OwnsSession()
  public async submit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SubmitRequestSchema)) body: SubmitRequestDto,
  ): Promise<unknown> {
    const result = await submitAnswers(id, getRequestContext().userId, body, {
      quizRepo: this.quizRepo,
      submissionRepo: this.submissionRepo,
    });
    return Object.freeze(SubmitResponseSchema.parse(result));
  }
}
