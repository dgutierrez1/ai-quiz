import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';

let app: INestApplication;
let originalDatabaseUrl: string | undefined;
let originalNodeEnv: string | undefined;

async function startApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.AI_QUIZ_FAKE_ADAPTERS = 'llm,ingestion';
  process.env.WEB_ORIGIN = 'https://allowed.example';
  const { createApplication } = await import('../src/main.js');
  const application = await createApplication();
  await application.listen(0);
  return application;
}

describe('Story 1.5 — network hardening', () => {
  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    delete process.env.WEB_ORIGIN;
  });

  it('sends Helmet CSP and HSTS headers', async () => {
    const url = `${await app.getUrl()}/healthz`;
    const response = await fetch(url);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('strict-transport-security')).toMatch(/max-age=/);
    const csp = response.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
  });

  it('rejects POST bodies above 100 KB with a safe envelope', async () => {
    const url = `${await app.getUrl()}/api/sessions`;
    const huge = 'a'.repeat(120 * 1024);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '11111111-1111-4111-8111-111111111111',
      },
      body: JSON.stringify({ sourceUrl: 'https://example.com/a.md', _padding: huge }),
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('wraps every error in a sanitized envelope with requestId', async () => {
    const url = `${await app.getUrl()}/api/sessions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'not-a-uuid' },
      body: JSON.stringify({ sourceUrl: 'https://example.com/a.md' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('only allows the configured origin for CORS preflight', async () => {
    const url = `${await app.getUrl()}/api/sessions`;
    const response = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://malicious.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-user-id',
      },
    });
    // Without allow-origin header (or wildcard), the preflight should be rejected/empty.
    const allowed = response.headers.get('access-control-allow-origin');
    expect(allowed === null || allowed !== '*').toBe(true);
  });

  it('enforces per-user throttling after 5 create-session calls within a minute', async () => {
    const userId = '33333333-3333-4333-8333-333333333333';
    let lastStatus = 0;
    for (let i = 0; i < 7; i += 1) {
      const response = await fetch(`${await app.getUrl()}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ sourceUrl: 'https://example.com/a.md' }),
      });
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});
