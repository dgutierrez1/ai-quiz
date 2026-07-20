import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const LOCAL_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';
const UNREACHABLE_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@127.0.0.1:59999/ai_quiz';

let healthyApp: INestApplication;
let degradedApp: INestApplication;
let originalDatabaseUrl: string | undefined;
let originalNodeEnv: string | undefined;

async function startApp(databaseUrl: string): Promise<INestApplication> {
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';
  process.env.AI_QUIZ_FAKE_ADAPTERS = 'llm,ingestion';
  vi.resetModules();
  const { createApplication } = await import('../src/main.js');
  const app = await createApplication();
  await app.listen(0);
  return app;
}

async function getJson(app: INestApplication, path: string): Promise<Response> {
  return fetch(`${await app.getUrl()}${path}`);
}

describe('health endpoints', () => {
  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.DATABASE_URL = LOCAL_DATABASE_URL;
    process.env.NODE_ENV = 'test';
    process.env.AI_QUIZ_FAKE_ADAPTERS = 'llm,ingestion';
    healthyApp = await startApp(LOCAL_DATABASE_URL);
    degradedApp = await startApp(UNREACHABLE_DATABASE_URL);
  });

  afterAll(async () => {
    await Promise.all([healthyApp.close(), degradedApp.close()]);
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

  it('returns process liveness from /healthz while the database is unreachable', async () => {
    const response = await getJson(degradedApp, '/healthz');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('returns an up deep-health response when Postgres is reachable', async () => {
    const response = await getJson(healthyApp, '/api/health');
    const body = (await response.json()) as { status: string; db: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');
  });

  it('returns a degraded deep-health response when Postgres is unreachable', async () => {
    const response = await getJson(degradedApp, '/api/health');
    const body = (await response.json()) as { status: string; db: string };

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('down');
  });
});
