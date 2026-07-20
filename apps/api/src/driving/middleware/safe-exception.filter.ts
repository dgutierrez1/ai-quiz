import { randomUUID } from 'node:crypto';

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ChatNotAvailableError } from '../../domain/chat/errors/chat-not-available.error.js';
import { CategorySelectionInfeasibleError } from '../../domain/quiz/errors/category-selection-infeasible.error.js';
import { DocTooLargeError } from '../../domain/quiz/errors/doc-too-large.error.js';
import { DocTooShortError } from '../../domain/quiz/errors/doc-too-short.error.js';
import { UntrustedLlmOutputError } from '../../domain/quiz/errors/generation.errors.js';
import { IngestTimeoutError } from '../../domain/quiz/errors/ingest-timeout.error.js';
import { NotFoundError } from '../../domain/quiz/errors/not-found.error.js';
import { SsrfBlockedError } from '../../domain/quiz/errors/ssrf-blocked.error.js';
import { IncompleteSubmissionError } from '../../domain/submission/errors/incomplete-submission.error.js';
import { SessionNotReadyError } from '../../domain/submission/errors/session-not-ready.error.js';
/**
 * Strip sensitive payloads out of an error before it is logged.
 *
 * Drizzle/node-postgres errors embed the full failed statement AND a
 * `params: <comma-separated bind values>` line. Those bind values routinely
 * include the internal `users.id`, session ids and document text — so logging
 * such an error verbatim defeats the pino redaction list entirely (that list
 * can only redact known FIELDS, and this is all one opaque message string).
 *
 * Redacting here, at the single place unhandled errors are logged, is what
 * keeps constitution rule 9 true in practice.
 */
function scrubForLog(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return raw
    .replace(/^\s*params:.*$/gim, '  params: [redacted]')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      '[redacted-uuid]',
    );
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeExceptionFilter.name);
  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { id?: string }>();
    request.id ||= randomUUID();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let extra: Record<string, unknown> | undefined;
    if (exception instanceof NotFoundError) {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Resource not found';
    } else if (exception instanceof IncompleteSubmissionError) {
      status = 400;
      code = 'INCOMPLETE_SUBMISSION';
      message = exception.message;
    } else if (exception instanceof SessionNotReadyError) {
      status = 409;
      code = 'SESSION_NOT_READY';
      message = exception.message;
      extra = { status: exception.status };
    }
    // Story 4.1 AC #4 — mirrors the SessionNotReadyError 409 shape above
    // (AD-15 precedent): `currentStatus` carries 'pending'|'failed', never a
    // fallthrough into the submitted/ready branch's answer-bearing content.
    else if (exception instanceof ChatNotAvailableError) {
      status = 409;
      code = 'CHAT_NOT_AVAILABLE';
      message = exception.message;
      extra = { currentStatus: exception.currentStatus };
    }
    // Generation-path domain errors (FR-15/FR-16). Each of these is a
    // deliberate, ACTIONABLE rejection with a user-facing hint — surfacing any
    // of them as a bare 500 would tell the user "something broke" when the
    // system in fact worked exactly as specified and knows what to advise.
    else if (exception instanceof DocTooShortError) {
      status = 400;
      code = 'DOC_TOO_SHORT';
      message = exception.message;
    } else if (exception instanceof DocTooLargeError) {
      status = 400;
      code = 'DOC_TOO_LARGE';
      message = exception.message;
    } else if (exception instanceof SsrfBlockedError) {
      status = 400;
      code = 'SSRF_BLOCKED';
      message = exception.message;
    } else if (exception instanceof IngestTimeoutError) {
      status = 400;
      code = 'INGEST_TIMEOUT';
      message = exception.message;
    } else if (exception instanceof CategorySelectionInfeasibleError) {
      status = 400;
      code = 'CATEGORY_SELECTION_INFEASIBLE';
      message = exception.message;
    } else if (exception instanceof UntrustedLlmOutputError) {
      // 502, not 500: the failure is upstream (the model returned output we
      // refused to trust), and the session row is already persisted as 'failed'.
      status = 502;
      code = 'UNTRUSTED_LLM_OUTPUT';
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code =
        (
          {
            400: 'BAD_REQUEST',
            401: 'UNAUTHORIZED',
            404: 'NOT_FOUND',
            413: 'PAYLOAD_TOO_LARGE',
            429: 'TOO_MANY_REQUESTS',
          } as Record<number, string>
        )[status] ?? 'HTTP_ERROR';
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message?.toString() ?? exception.message);
    } else
      this.logger.error(
        'Unhandled request error',
        scrubForLog(exception instanceof Error ? exception.stack : undefined),
      );
    response.status(status).json({ error: { code, message, requestId: request.id, ...extra } });
  }
}
