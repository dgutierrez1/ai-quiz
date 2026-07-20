import type { CreateSessionRequest, QuizSessionRow, SessionCreatedResponse } from '@ai-quiz/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

let app: INestApplication;
let originalDatabaseUrl: string | undefined;
let originalNodeEnv: string | undefined;

async function startApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.AI_QUIZ_FAKE_ADAPTERS = 'llm,ingestion';
  const { createApplication } = await import('../src/main.js');
  const application = await createApplication();
  await application.listen(0);
  return application;
}

async function postSession(
  userId: string,
  body: Partial<CreateSessionRequest> = {},
): Promise<{ status: number; body: SessionCreatedResponse | Record<string, unknown> }> {
  const url = `${await app.getUrl()}/api/sessions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify({ sourceUrl: 'https://example.com/a.md', ...body }),
  });
  const json = (await response.json()) as SessionCreatedResponse | Record<string, unknown>;
  return { status: response.status, body: json };
}

async function getSession(
  userId: string,
  sessionId: string,
): Promise<{ status: number; body: QuizSessionRow | Record<string, unknown> }> {
  const url = `${await app.getUrl()}/api/sessions/${sessionId}`;
  const response = await fetch(url, { headers: { 'x-user-id': userId } });
  const json = (await response.json()) as QuizSessionRow | Record<string, unknown>;
  return { status: response.status, body: json };
}

describe('ownership and RLS isolation (Story 1.4)', () => {
  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('creates a session for the calling user and returns 201', async () => {
    const result = await postSession(USER_A);
    expect(result.status).toBe(201);
    const body = result.body as SessionCreatedResponse;
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(['pending', 'ready', 'failed']).toContain(body.status);
  });

  it('returns the same session for the owner', async () => {
    const created = (await postSession(USER_A)).body as SessionCreatedResponse;
    const fetched = await getSession(USER_A, created.id);
    expect(fetched.status).toBe(200);
    expect((fetched.body as QuizSessionRow).id).toBe(created.id);
  });

  it('returns a 404 safe envelope for a non-owner request (not 403)', async () => {
    const created = (await postSession(USER_A)).body as SessionCreatedResponse;
    const cross = await getSession(USER_B, created.id);
    expect(cross.status).toBe(404);
    expect(cross.body).toHaveProperty('error.code');
  });

  it('returns a 400 safe envelope for malformed X-User-Id', async () => {
    const url = `${await app.getUrl()}/api/sessions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'not-a-uuid' },
      body: JSON.stringify({ sourceUrl: 'https://example.com/a.md' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('error.code');
  });

  it('returns a 404 safe envelope for an unknown session id', async () => {
    const result = await getSession(USER_A, '00000000-0000-4000-8000-000000000000');
    expect(result.status).toBe(404);
    expect(result.body).toHaveProperty('error.code');
  });
});
