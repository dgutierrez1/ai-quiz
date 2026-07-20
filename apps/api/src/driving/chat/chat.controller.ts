import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';

import { ChatRepository } from '../../adapters/persistence/drizzle/chat.repository.js';
import { QuizSessionRepository } from '../../adapters/persistence/drizzle/quiz-session.repository.js';
import { SubmissionRepository } from '../../adapters/persistence/drizzle/submission.repository.js';
import {
  ChatHistoryResponseSchema,
  type ChatMessageRequestDto,
  ChatMessageRequestSchema,
  ChatMessageWireSchema,
} from '../../domain/chat/dto/chat.schemas.js';
import { WEB_SEARCH_PORT, type WebSearchPort } from '../../domain/chat/ports/web-search.port.js';
import { chat } from '../../domain/chat/use-cases/chat.use-case.js';
import { LLM_PORT, type LlmPort } from '../../domain/ports/llm.port.js';
import { TRACING_PORT, type TracingPort } from '../../domain/ports/tracing.port.js';
import { IdentityInterceptor } from '../middleware/identity.interceptor.js';
import { OwnsSession } from '../middleware/own-session.interceptor.js';
import { getRequestContext } from '../middleware/request-context.js';
import { ThrottleChat } from '../middleware/throttler.config.js';
import { ZodValidationPipe } from '../sessions/zod-validation.pipe.js';

@Controller('sessions')
@UseInterceptors(IdentityInterceptor)
export class ChatController {
  public constructor(
    private readonly quizRepo: QuizSessionRepository,
    private readonly submissionRepo: SubmissionRepository,
    private readonly chatRepo: ChatRepository,
    @Inject(TRACING_PORT) private readonly tracing: TracingPort,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(WEB_SEARCH_PORT) private readonly webSearch: WebSearchPort | null,
  ) {}

  // Story 4.1 AC #2 — body accepts ONLY `content`, no `questionId`, no
  // focused-context branch. Story 4.1 AC #14 — 20/min per-route throttle
  // (per-user AND per-IP, stricter wins, via the same `@Throttle()`
  // mechanism Story 1.5 established).
  @Post(':id/chat')
  @HttpCode(200)
  @OwnsSession()
  @ThrottleChat()
  public async postChat(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChatMessageRequestSchema)) body: ChatMessageRequestDto,
  ): Promise<unknown> {
    const userId = getRequestContext().userId;
    // Story 4.2 AC #13 — TAVILY_API_KEY unset => `WEB_SEARCH_PORT` binds null
    // (see adapters.module.ts), so the use-case never receives a search
    // provider and the tool definition is never constructed at all.
    const result = await chat(
      { sessionId: id, userId, content: body.content },
      {
        quizRepo: this.quizRepo,
        submissionRepo: this.submissionRepo,
        chatRepo: this.chatRepo,
        llm: this.llm,
        webSearch: this.webSearch ?? undefined,
        tracing: this.tracing,
      },
    );
    return result;
  }

  // Story 4.1 AC #7 — latest 50 messages, keyset pagination, no LIMIT/OFFSET.
  // No throttle override — covered by the existing global 30/min.
  @Get(':id/chat')
  @OwnsSession()
  public async getChat(
    @Param('id') id: string,
    @Query('before') before?: string,
  ): Promise<unknown> {
    const userId = getRequestContext().userId;
    let cursor: Date | undefined;
    if (before !== undefined) {
      const parsed = new Date(before);
      if (Number.isNaN(parsed.getTime()))
        throw new BadRequestException('before must be a valid ISO timestamp');
      cursor = parsed;
    }
    const page = await this.chatRepo.findRecentForUser(id, userId, cursor);
    return Object.freeze(
      ChatHistoryResponseSchema.parse({
        messages: page.messages.map((message) => ChatMessageWireSchema.parse(message)),
        hasMore: page.hasMore,
      }),
    );
  }
}
