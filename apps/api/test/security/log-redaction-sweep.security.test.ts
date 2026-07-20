// apps/api/test/security/log-redaction-sweep.security.test.ts
//
// Story 5.3 AC #12 / Task 6 — the consolidated "nothing leaks across a
// realistic sequence" sweep. Two parts:
//
//   Part A — directly exercises the REAL, exported pino redaction config
//   (`LOGGER_REDACTION_PATHS` from `logger.config.ts`, Story 1.6) against
//   wire-shaped objects, using a captured in-memory writable stream (never
//   a real file). This is the closest available equivalent to "Story
//   1.6's own pino test-sink pattern" the story text references — no such
//   file actually exists yet in this codebase (see this test's own
//   reported findings), so this IS that pattern's first instance, built
//   from the real exported config rather than a reimplementation of it.
//
//   Part B — drives a real, representative request sequence through the
//   actual running app (per-route driving-layer convention: real HTTP
//   calls against a listening Nest app, matching every other file in this
//   directory) and captures EXACTLY what the app's real logger emits
//   today via `app.useLogger(...)` — no logging middleware is added by
//   this test that doesn't already exist in production. See this test's
//   own inline notes and this story's final report for why that matters:
//   `apps/api/src/driving/middleware/logger.config.ts`'s pino instance is
//   never actually imported by `main.ts` or any module bootstrap, so no
//   *structured* per-request log line exists today — Part B observes
//   Nest's actual default logger (which IS live, e.g. `SafeExceptionFilter`
//   uses it for unhandled errors), not a hypothetical wired-in pino path.

import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import type { INestApplication, LoggerService } from '@nestjs/common';
import type { Pool } from 'pg';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { LOGGER_REDACTION_PATHS } from '../../src/driving/middleware/logger.config.js';
import { seedUser } from '../helpers/seed-session-row.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';

// ── Part A — the exported redaction config against realistic shapes ────────

class MemorySink extends Writable {
  public lines: string[] = [];
  public override _write(chunk: Buffer, _enc: string, callback: () => void): void {
    this.lines.push(chunk.toString('utf8'));
    callback();
  }
  public text(): string {
    return this.lines.join('');
  }
}

function buildCapturingPino(): { logger: pino.Logger; sink: MemorySink } {
  const sink = new MemorySink();
  const logger = pino(
    { redact: { paths: [...LOGGER_REDACTION_PATHS], censor: '[redacted]' } },
    sink,
  );
  return { logger, sink };
}

describe('Part A — LOGGER_REDACTION_PATHS (Story 1.6 config) against realistic wire shapes', () => {
  it('censors every deny-listed path and the raw secret values never appear in the serialized output', () => {
    const { logger, sink } = buildCapturingPino();
    const rawUserId = `user-id-${randomUUID()}`;
    const rawCookie = `session=${randomUUID()}`;
    const rawAuth = `Bearer ${randomUUID()}`;
    const rawSourceUrl = 'https://secret.example/private-doc.md';
    const rawChatContent = 'this is private chat content, never log me';
    const rawApiKey = `sk-${randomUUID().replace(/-/g, '')}`;

    logger.info({
      req: {
        headers: { 'x-user-id': rawUserId, cookie: rawCookie, authorization: rawAuth },
        body: { sourceUrl: rawSourceUrl, content: rawChatContent, chunks: ['secret chunk one'] },
      },
      res: { body: { finalScore: 4 } },
      someService: {
        document: 'the whole document text',
        markdown: 'raw markdown',
        prompt: 'the LLM prompt',
        response: 'the LLM response',
      },
      provider: { secret: 'provider-secret-value', apiKey: rawApiKey },
    });
    logger.flush?.();

    const output = sink.text();
    expect(output).not.toContain(rawUserId);
    expect(output).not.toContain(rawCookie);
    expect(output).not.toContain(rawAuth);
    expect(output).not.toContain(rawSourceUrl);
    expect(output).not.toContain(rawChatContent);
    expect(output).not.toContain('secret chunk one');
    expect(output).not.toContain('the whole document text');
    expect(output).not.toContain('raw markdown');
    expect(output).not.toContain('the LLM prompt');
    expect(output).not.toContain('the LLM response');
    expect(output).not.toContain('provider-secret-value');
    expect(output).not.toContain(rawApiKey);
    // The censor marker must actually have fired somewhere, not just be
    // "nothing logged" (a redact path that silently doesn't match looks
    // identical to a working one — Story 1.6's own Dev Notes flag this
    // exact trap).
    expect(output).toContain('[redacted]');
  });
});

// ── Part B — a real request sequence through the real running app ─────────

class CapturingLogger implements LoggerService {
  public lines: string[] = [];
  private record(args: unknown[]): void {
    this.lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  }
  public log(...args: unknown[]): void {
    this.record(args);
  }
  public error(...args: unknown[]): void {
    this.record(args);
  }
  public warn(...args: unknown[]): void {
    this.record(args);
  }
  public debug(...args: unknown[]): void {
    this.record(args);
  }
  public verbose(...args: unknown[]): void {
    this.record(args);
  }
  public text(): string {
    return this.lines.join('\n');
  }
}

let app: INestApplication;
let pool: Pool;
let baseUrl: string;
let capturingLogger: CapturingLogger;
let chatRoutesExist = false;

const PLANTED_ENV_SECRET = `sk-planted-env-secret-${randomUUID().replace(/-/g, '')}`;
const ORIGINAL_MINIMAX_KEY = process.env.MINIMAX_API_KEY;

async function startApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.AI_QUIZ_FAKE_ADAPTERS = 'llm,ingestion';
  const { createApplication } = await import('../../src/main.js');
  const application = await createApplication();
  capturingLogger = new CapturingLogger();
  application.useLogger(capturingLogger);
  await application.listen(0);
  return application;
}

describe('Part B — a representative real request sequence leaves nothing sensitive in the captured log stream', () => {
  beforeAll(async () => {
    // A distinguishable, fake *_KEY value — proves "no *_KEY/*_SECRET env
    // value ever appears in logs" against a value we can actually search
    // for (the real local dev env leaves these empty per .env.example, so
    // asserting against an empty string would be vacuous).
    process.env.MINIMAX_API_KEY = PLANTED_ENV_SECRET;

    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
    baseUrl = await app.getUrl();

    const chatProbe = await fetch(
      `${baseUrl}/api/sessions/00000000-0000-4000-8000-000000000000/chat`,
      {
        headers: { 'x-user-id': randomUUID() },
      },
    );
    const probeBody = (await chatProbe.json()) as { error?: { message?: string } };
    chatRoutesExist = chatProbe.status === 404 && probeBody.error?.message === 'Resource not found';
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    if (ORIGINAL_MINIMAX_KEY === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = ORIGINAL_MINIMAX_KEY;
  });

  afterEach(() => {
    capturingLogger.lines = [];
  });

  it('runs the full representative sequence and captures whatever the app really logs today', async () => {
    const realExternalUserId = randomUUID();
    const internalUserId = await seedUser(pool, realExternalUserId);
    const plantedAuthValue = `Bearer planted-auth-should-never-leak-${randomUUID()}`;
    const plantedChatSecret = `sk-${randomUUID().replace(/-/g, '')}`;

    // 1. A session-list request carrying a real X-User-Id.
    await fetch(`${baseUrl}/api/sessions`, { headers: { 'x-user-id': realExternalUserId } });

    // 2. A request with an Authorization-shaped header (unused by the app,
    //    but proves it would never surface even if something read it).
    await fetch(`${baseUrl}/api/sessions`, {
      headers: { 'x-user-id': realExternalUserId, authorization: plantedAuthValue },
    });

    // 3. A deliberately-triggered 500: a syntactically-invalid session id
    //    reaches the ownership query as a raw string, and Postgres rejects
    //    it as an invalid uuid literal — an unhandled error that
    //    `SafeExceptionFilter`'s catch-all branch logs via Nest's default
    //    logger (see this test file's header + this story's final report:
    //    this is a REAL discovered leak path, not a synthetic one).
    await fetch(`${baseUrl}/api/sessions/not-a-valid-uuid`, {
      headers: { 'x-user-id': realExternalUserId },
    });

    // 4. A chat message containing a secret-shaped string — only if the
    //    chat routes are wired in this run (see this story's runtime
    //    detection convention, same as `cross-user-isolation.security.test.ts`).
    if (chatRoutesExist) {
      const createSessionResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'GET',
        headers: { 'x-user-id': realExternalUserId },
      });
      await createSessionResponse.text();
      // No `ready` session is cheaply available without a full generation
      // pipeline call in this test — POST to a nonexistent session id is
      // still a real HTTP round-trip carrying the planted secret in the
      // body, which is exactly what this leg needs to prove (the body
      // never reaches the log stream), independent of whether the route
      // 404s on ownership.
      await fetch(`${baseUrl}/api/sessions/00000000-0000-4000-8000-000000000000/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': realExternalUserId },
        body: JSON.stringify({ content: `What is the answer? My key is ${plantedChatSecret}` }),
      });
    }

    const captured = capturingLogger.text();

    // Per AC #12's literal wording: the raw X-User-Id HEADER value.
    expect(captured).not.toContain(realExternalUserId);
    expect(captured).not.toContain(plantedAuthValue);
    expect(captured).not.toContain(PLANTED_ENV_SECRET);
    if (chatRoutesExist) {
      expect(captured).not.toContain(plantedChatSecret);
    }

    // Stricter check beyond AC #12's literal wording, in the same spirit:
    // the INTERNAL users.id (the exact value `app.user_id` is set to for
    // RLS — equally identity-correlating as the external X-User-Id) must
    // never appear unredacted either. Drizzle/node-postgres errors embed
    // the full failed statement plus a `params: <bind values>` line, which
    // routinely includes the internal `users.id` — `SafeExceptionFilter`'s
    // `scrubForLog()` (see that file) exists specifically to strip this
    // before logging `exception.stack`, since the pino redaction list can
    // only redact known FIELDS, not values buried inside one opaque
    // message string.
    expect(
      captured,
      'internal users.id must not appear unredacted in logs (see SafeExceptionFilter#scrubForLog)',
    ).not.toContain(internalUserId);
  });
});
