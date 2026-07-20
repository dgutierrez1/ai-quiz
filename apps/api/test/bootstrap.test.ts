import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { createApplication as CreateApplication } from '../src/main.js';

const UNREACHABLE_DATABASE_URL = 'postgres://ai_quiz:ai_quiz@127.0.0.1:59999/ai_quiz';
let createApplication: typeof CreateApplication;
let app: INestApplication;
let originalDatabaseUrl: string | undefined;
let originalNodeEnv: string | undefined;

describe('application bootstrap', () => {
  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.DATABASE_URL = UNREACHABLE_DATABASE_URL;
    process.env.NODE_ENV = 'test';
    ({ createApplication } = await import('../src/main.js'));
    app = await createApplication();
    await app.listen(0);
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

  it('uses the Express adapter', () => {
    expect(app.getHttpAdapter().getType()).toBe('express');
  });

  it('applies /api while excluding GET /healthz', async () => {
    const baseUrl = await app.getUrl();
    const healthz = await fetch(`${baseUrl}/healthz`);
    const apiHealth = await fetch(`${baseUrl}/api/health`);

    expect(healthz.status).toBe(200);
    expect(apiHealth.status).toBe(503);
  });
});
