import type { GeneratedQuestionDto, QuestionPoolDto } from '@ai-quiz/shared';
import { getTestDoubles, resetTestDoubles } from '@ai-quiz/test-doubles';
import type { INestApplication } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, createPool } from '../../src/adapters/persistence/drizzle/client.js';
import { quizSessions, users } from '../../src/adapters/persistence/drizzle/schema.js';

// SM-1-style end-to-end proof (Story 2.6 AC #8) — the full pipeline
// (ingest -> neutralize/chunk/guard -> LLM -> validate -> classify shortfall
// -> category feasibility search -> stratified draw -> persist -> return),
// driven entirely through the real HTTP surface. Network-free:
// `AI_QUIZ_FAKE_ADAPTERS=llm,ingestion` binds both ports to the fakes in
// `@ai-quiz/test-doubles`, which serve a deterministic fixture document and a
// deterministic pool unless a test configures a specific response via
// `getTestDoubles().llm.pool` / `.ingestion.document`.

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER_A = '44444444-4444-4444-8444-444444444444';
const USER_B = '55555555-5555-4555-8555-555555555555';

let app: INestApplication;
let verifyPool: Pool;
let originalDatabaseUrl: string | undefined;
let originalNodeEnv: string | undefined;

async function startApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.AI_QUIZ_FAKE_ADAPTERS = 'llm,ingestion';
  const { createApplication } = await import('../../src/main.js');
  const application = await createApplication();
  await application.listen(0);
  return application;
}

/** Direct-DB read, bypassing the HTTP layer entirely — used only to prove
 * the failure-state write survives the request-transaction rollback (the
 * HTTP failure response never carries the session id). */
async function latestSessionStatusFor(
  externalUserId: string,
): Promise<{ status: string; errorMessage: string | null } | undefined> {
  const db = createDatabase(verifyPool);
  const [user] = await db.select().from(users).where(eq(users.externalId, externalUserId)).limit(1);
  if (!user) return undefined;
  const [session] = await db
    .select({ status: quizSessions.status, errorMessage: quizSessions.errorMessage })
    .from(quizSessions)
    .where(eq(quizSessions.userId, user.id))
    .orderBy(desc(quizSessions.createdAt))
    .limit(1);
  return session;
}

interface JsonBody {
  readonly [key: string]: unknown;
}

async function postSession(
  userId: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: JsonBody }> {
  const url = `${await app.getUrl()}/api/sessions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify({ sourceUrl: 'https://example.com/fixture.md', ...body }),
  });
  const json = (await response.json()) as JsonBody;
  return { status: response.status, body: json };
}

async function getSession(
  userId: string,
  sessionId: string,
): Promise<{ status: number; body: JsonBody }> {
  const url = `${await app.getUrl()}/api/sessions/${sessionId}`;
  const response = await fetch(url, { headers: { 'x-user-id': userId } });
  const json = (await response.json()) as JsonBody;
  return { status: response.status, body: json };
}

/** Recursively asserts `key` never appears anywhere in `value` — the wire-shape proof for isCorrect. */
function assertKeyAbsent(value: unknown, key: string, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertKeyAbsent(item, key, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      expect(k, `unexpected key "${key}" found at ${path}.${k}`).not.toBe(key);
      assertKeyAbsent(v, key, `${path}.${k}`);
    }
  }
}

const GROUNDED_WORD = 'fixture';

function groundedQuestion(category: string, seed: number): GeneratedQuestionDto {
  return {
    text: `Which statement about the ${GROUNDED_WORD} document is correct (case ${seed})?`,
    type: 'single',
    category,
    explanation: `${GROUNDED_WORD} explanation ${seed}`,
    answers: [
      { position: 0, text: `${GROUNDED_WORD} answer A`, isCorrect: true },
      { position: 1, text: 'plausible but wrong B', isCorrect: false },
      { position: 2, text: 'plausible but wrong C', isCorrect: false },
      { position: 3, text: 'plausible but wrong D', isCorrect: false },
    ],
  };
}

function ungroundedQuestion(category: string, seed: number): GeneratedQuestionDto {
  return {
    text: `zzzznotgrounded${seed} zzzzneverinthesource${seed}`,
    type: 'single',
    category,
    explanation: 'zzzz',
    answers: [
      { position: 0, text: 'zzzz1', isCorrect: true },
      { position: 1, text: 'zzzz2', isCorrect: false },
      { position: 2, text: 'zzzz3', isCorrect: false },
      { position: 3, text: 'zzzz4', isCorrect: false },
    ],
  };
}

function poolOf(
  count: number,
  categories: readonly string[],
  build: (category: string, seed: number) => GeneratedQuestionDto,
): QuestionPoolDto {
  const questions: GeneratedQuestionDto[] = [];
  for (let i = 0; i < count; i += 1) questions.push(build(categories[i % categories.length]!, i));
  return Object.freeze({ questions });
}

describe('generation pipeline — end to end via HTTP (Stories 2.4-2.6)', () => {
  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    app = await startApp();
    verifyPool = createPool(LOCAL_DATABASE_URL);
  });

  afterAll(async () => {
    await verifyPool.end();
    await app.close();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  afterEach(() => {
    resetTestDoubles();
  });

  it('POST /api/sessions returns a playable quiz — status ready, full questionCount, no isCorrect on the wire', async () => {
    const result = await postSession(USER_A, { questionCount: 8 });
    expect(result.status).toBe(201);
    expect(result.body.status).toBe('ready');
    const questions = result.body.questions as unknown[];
    expect(questions).toHaveLength(8);
    expect(result.body.actualCount).toBeUndefined(); // only present when < requested
    assertKeyAbsent(result.body, 'isCorrect');
    const categories = new Set((result.body.selectedCategories as string[]) ?? []);
    expect(categories.size).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/sessions/:id replays the identical persisted quiz (no re-run), and is invisible to another user (404, not 403)', async () => {
    // A single POST shared across both assertions — `POST /api/sessions`
    // is throttled to 5/min per IP (@ThrottleCreateSession), and this test
    // file's IP budget is already tight across its five POSTs; folding the
    // ownership check in here (GET is not throttled) keeps the file at
    // exactly 5 POSTs total instead of 6.
    const created = await postSession(USER_A, { questionCount: 5 });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const first = await getSession(USER_A, id);
    const second = await getSession(USER_A, id);
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    assertKeyAbsent(second.body, 'isCorrect');
    expect((second.body.questions as unknown[]).length).toBe(
      (created.body.questions as unknown[]).length,
    );

    const cross = await getSession(USER_B, id);
    expect(cross.status).toBe(404);
  });

  it('shortfall: 5 <= V < questionCount -> status ready, actualCount === V, no padding', async () => {
    getTestDoubles().llm.pool = poolOf(6, ['alpha', 'beta'], groundedQuestion);
    const result = await postSession(USER_A, { questionCount: 8 });
    expect(result.status).toBe(201);
    expect(result.body.status).toBe('ready');
    expect(result.body.actualCount).toBe(6);
    expect((result.body.questions as unknown[]).length).toBe(6);
  });

  it(
    'failure: LLM never produces a usable pool -> non-2xx response, but status=failed durably survives the request rollback',
    { timeout: 15_000 },
    async () => {
      const failureUser = '66666666-6666-4666-8666-666666666666';
      // The failure-write re-upserts `users` on its own fresh connection (see
      // quiz-persistence.repository.ts markSessionFailed) — that resolves
      // cleanly once this user's row is already committed from a prior
      // request. Seed that first, matching the realistic flow (a returning
      // user's Nth generation attempt failing).
      const seed = await postSession(failureUser, { questionCount: 5 });
      expect(seed.status).toBe(201);

      getTestDoubles().llm.pool = poolOf(12, ['alpha', 'beta'], ungroundedQuestion);
      const result = await postSession(failureUser, {
        questionCount: 8,
        provider: 'minimax',
        model: 'MiniMax-M3',
      });
      expect(result.status).toBeGreaterThanOrEqual(500);

      // The request transaction (which holds no other write once the 'ready'
      // path never ran) rolled back — but `markSessionFailed` durably wrote
      // status='failed' on its OWN, separately-committed transaction (AD-9).
      // That write is SCHEDULED just past the request/response cycle (see
      // `scheduleFailureWrite`'s doc comment — an awaited write here would
      // deadlock against this same request's still-open transaction), so give
      // it a moment before reading it back on a brand-new connection.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const persisted = await latestSessionStatusFor(failureUser);
      expect(persisted?.status).toBe('failed');
      expect(persisted?.errorMessage).toBeTruthy();
    },
  );
});
