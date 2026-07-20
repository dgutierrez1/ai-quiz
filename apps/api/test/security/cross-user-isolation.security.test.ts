// apps/api/test/security/cross-user-isolation.security.test.ts
//
// Story 5.3 AC #1 (API-layer slice) / Task 2 — the consolidated cross-user
// isolation sweep across every session-scoped route that exists in this
// run. `ownership-submission.security.test.ts` (Story 3.1) and
// `ownership-list.security.test.ts` (Story 5.1) already prove the 404 /
// list-scoping behavior for `POST /submit` and `GET /api/sessions`
// respectively — this file does NOT re-prove those in isolation (see this
// story's anti-pattern watchlist: don't duplicate coverage that already
// gates the build). What THIS file adds, that no earlier story's test
// covers:
//
//   1. `GET /api/sessions/:id` cross-user 404 — no earlier story's security
//      suite hits this exact route as a non-owner.
//   2. Byte-identical (status + error.code + error.message) response
//      bodies for "not owned" vs "genuinely not found" on every route
//      checked — proving the 404 doesn't leak existence through some
//      subtle body difference. `requestId` is intentionally excluded from
//      the equality check: it is a per-request correlation id generated
//      fresh on every call by design (`SafeExceptionFilter`), not a leak
//      vector — comparing it would make every pair of requests "different"
//      for a reason that has nothing to do with existence-leak.
//   3. The chat routes (`GET`/`POST /api/sessions/:id/chat`), IF the
//      concurrent chat-backend story has landed in this run — detected at
//      runtime by probing the route once and reading the response shape,
//      exactly like `rls-full-coverage.security.test.ts` detects
//      `chat_messages` via `information_schema`. This suite must stay
//      green whether or not that story has landed yet.
//   4. An explicit assertion that no route in this sweep EVER returns 403
//      — a 403 anywhere on a session-scoped route is itself a defect this
//      story exists to catch (Consistency Conventions — "404 never 403").

import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { type SeedQuestionSpec, seedQuizSession } from '../helpers/seed-quiz-session.js';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const NONEXISTENT_SESSION_ID = '00000000-0000-4000-8000-000000000000';

const FIVE_QUESTIONS: SeedQuestionSpec[] = [
  { type: 'single', category: 'Cat A', correctPositions: [0] },
  { type: 'single', category: 'Cat A', correctPositions: [1] },
  { type: 'single', category: 'Cat A', correctPositions: [2] },
  { type: 'single', category: 'Cat A', correctPositions: [3] },
  { type: 'single', category: 'Cat A', correctPositions: [0] },
];

let app: INestApplication;
let pool: Pool;
let baseUrl: string;
let chatRoutesExist = false;

async function startApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.AI_QUIZ_FAKE_ADAPTERS = 'llm,ingestion';
  const { createApplication } = await import('../../src/main.js');
  const application = await createApplication();
  await application.listen(0);
  return application;
}

interface ErrorEnvelope {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}

async function get(path: string, userId: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'x-user-id': userId } });
  return { status: response.status, body: await response.json() };
}

async function post(
  path: string,
  userId: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Strips `error.requestId` — see file header for why it's excluded from byte-identity checks. */
function withoutRequestId(body: unknown): unknown {
  const envelope = body as Partial<ErrorEnvelope>;
  if (!envelope.error) return body;
  const { requestId: _requestId, ...rest } = envelope.error;
  return { error: rest };
}

function completeRequestFor(questionIds: readonly string[]): {
  responses: { questionId: string; selected: number[] }[];
} {
  return { responses: questionIds.map((questionId) => ({ questionId, selected: [0] })) };
}

describe('Cross-user isolation sweep across every session-scoped route (Story 5.3 AC #1)', () => {
  beforeAll(async () => {
    pool = createPool(LOCAL_DATABASE_URL);
    app = await startApp();
    baseUrl = await app.getUrl();

    // Runtime detection: does the chat route exist in this build? The
    // concurrent chat-backend story may or may not have wired
    // `ChatModule` into `AppModule` yet. A route that doesn't exist at all
    // produces Nest's own default 404 body (`Cannot GET /...`), which is
    // NOT this app's `{error:{code:'NOT_FOUND',...}}` envelope — that
    // distinguishes "route doesn't exist" from "route exists and
    // correctly 404s a stranger".
    const probe = await get(`/api/sessions/${NONEXISTENT_SESSION_ID}/chat`, randomUUID());
    const probeBody = probe.body as Partial<ErrorEnvelope>;
    chatRoutesExist = probe.status === 404 && probeBody.error?.message === 'Resource not found';
    if (!chatRoutesExist) {
      // eslint-disable-next-line no-console -- deliberate, clear skip note (no user data logged)
      console.warn(
        '[cross-user-isolation] chat routes are not wired into AppModule yet in this run — skipping the ' +
          'chat-route assertions below. The session-detail and submit assertions still run unconditionally.',
      );
    }
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('GET /api/sessions/:id — a non-owner gets 404, never 403, never 200', async () => {
    const seed = await seedQuizSession(pool, randomUUID(), FIVE_QUESTIONS, { status: 'ready' });
    const otherUser = randomUUID();

    const result = await get(`/api/sessions/${seed.sessionId}`, otherUser);
    expect(result.status).toBe(404);
    expect(result.status).not.toBe(403);
    expect(result.body).toHaveProperty('error.code', 'NOT_FOUND');
  });

  it('POST /api/sessions/:id/submit — a non-owner gets 404, never 403, never 200', async () => {
    const seed = await seedQuizSession(pool, randomUUID(), FIVE_QUESTIONS, { status: 'ready' });
    const otherUser = randomUUID();

    const result = await post(
      `/api/sessions/${seed.sessionId}/submit`,
      otherUser,
      completeRequestFor(seed.questionIds),
    );
    expect(result.status).toBe(404);
    expect(result.status).not.toBe(403);
    expect(result.body).toHaveProperty('error.code', 'NOT_FOUND');
  });

  it('GET /api/sessions/:id/chat and POST /api/sessions/:id/chat — a non-owner gets 404, never 403, never 200 (only if chat routes exist yet)', async () => {
    if (!chatRoutesExist) return;

    const seed = await seedQuizSession(pool, randomUUID(), FIVE_QUESTIONS, { status: 'ready' });
    const otherUser = randomUUID();

    const getResult = await get(`/api/sessions/${seed.sessionId}/chat`, otherUser);
    expect(getResult.status).toBe(404);
    expect(getResult.status).not.toBe(403);
    expect(getResult.body).toHaveProperty('error.code', 'NOT_FOUND');

    const postResult = await post(`/api/sessions/${seed.sessionId}/chat`, otherUser, {
      content: 'hello',
    });
    expect(postResult.status).toBe(404);
    expect(postResult.status).not.toBe(403);
    expect(postResult.body).toHaveProperty('error.code', 'NOT_FOUND');
  });

  it('GET /api/sessions/:id — "not owned" and "genuinely not found" response bodies are byte-identical (aside from requestId)', async () => {
    const seed = await seedQuizSession(pool, randomUUID(), FIVE_QUESTIONS, { status: 'ready' });
    const stranger = randomUUID();
    const anyUser = randomUUID();

    const notOwned = await get(`/api/sessions/${seed.sessionId}`, stranger);
    const notFound = await get(`/api/sessions/${NONEXISTENT_SESSION_ID}`, anyUser);

    expect(notOwned.status).toBe(notFound.status);
    expect(notOwned.status).toBe(404);
    expect(withoutRequestId(notOwned.body)).toEqual(withoutRequestId(notFound.body));
  });

  it('POST /api/sessions/:id/submit — "not owned" and "genuinely not found" response bodies are byte-identical (aside from requestId)', async () => {
    const seed = await seedQuizSession(pool, randomUUID(), FIVE_QUESTIONS, { status: 'ready' });
    const stranger = randomUUID();
    const anyUser = randomUUID();

    const notOwned = await post(
      `/api/sessions/${seed.sessionId}/submit`,
      stranger,
      completeRequestFor(seed.questionIds),
    );
    const notFound = await post(`/api/sessions/${NONEXISTENT_SESSION_ID}/submit`, anyUser, {
      responses: [],
    });

    expect(notOwned.status).toBe(notFound.status);
    expect(notOwned.status).toBe(404);
    expect(withoutRequestId(notOwned.body)).toEqual(withoutRequestId(notFound.body));
  });

  it('GET /api/sessions/:id/chat — "not owned" and "genuinely not found" response bodies are byte-identical (aside from requestId) (only if chat routes exist yet)', async () => {
    if (!chatRoutesExist) return;

    const seed = await seedQuizSession(pool, randomUUID(), FIVE_QUESTIONS, { status: 'ready' });
    const stranger = randomUUID();
    const anyUser = randomUUID();

    const notOwned = await get(`/api/sessions/${seed.sessionId}/chat`, stranger);
    const notFound = await get(`/api/sessions/${NONEXISTENT_SESSION_ID}/chat`, anyUser);

    expect(notOwned.status).toBe(notFound.status);
    expect(notOwned.status).toBe(404);
    expect(withoutRequestId(notOwned.body)).toEqual(withoutRequestId(notFound.body));
  });
});
