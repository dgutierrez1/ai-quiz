import pino from 'pino';
// Redaction paths ensure that no request body, X-User-Id, document text, or
// chat content ever lands in logs. NestJS built-in logger is replaced by this
// pino instance for any code path that opts into the `Logger` token.
export const LOGGER_REDACTION_PATHS = [
  'req.headers.x-user-id',
  'req.headers.cookie',
  'req.headers.authorization',
  'req.body.sourceUrl',
  'req.body.content',
  'req.body.chunks',
  'res.body',
  '*.document',
  '*.markdown',
  '*.prompt',
  '*.response',
  '*.secret',
  '*.apiKey',
];
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: LOGGER_REDACTION_PATHS, censor: '[redacted]' },
});
