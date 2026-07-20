import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { validateEnv } from './config/env.js';
import { assertSingleMachine } from './driving/middleware/single-machine.guard.js';
import { runMigrations } from './migrate.js';

export async function createApplication(): Promise<INestApplication> {
  const adapter = new ExpressAdapter();
  const app = await NestFactory.create(AppModule, adapter, { bodyParser: false });
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ limit: '100kb', extended: true }));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      const message = error instanceof Error ? error.message : 'request error';
      if (/request entity too large/i.test(message)) {
        res.status(413).json({
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'request body too large',
            requestId: (res.getHeader('x-request-id') as string | undefined) ?? '',
          },
        });
        return;
      }
      next(error);
    },
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
    }),
  );
  const exactOrigin = process.env.WEB_ORIGIN;
  const previewPattern =
    process.env.NODE_ENV !== 'production' && process.env.WEB_ORIGIN_REGEX
      ? new RegExp(process.env.WEB_ORIGIN_REGEX)
      : undefined;
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      callback(null, !origin || origin === exactOrigin || Boolean(previewPattern?.test(origin)));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-User-Id'],
    maxAge: 600,
  });
  // Enable NestJS shutdown hooks so OnApplicationShutdown providers
  // (DatabaseModule's PoolShutdown) fire on graceful stop. Without this,
  // the pg pool leaks connections on Fly shutdown.
  app.enableShutdownHooks();
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'healthz', method: RequestMethod.GET }],
  });
  return app;
}

export async function bootstrap(): Promise<void> {
  const environment = validateEnv();
  assertSingleMachine(process.env);
  const app = await createApplication();
  // Bind explicitly to IPv4 '0.0.0.0'. Fly's IPv4 service mesh can't reach
  // a process that binds an IPv6-only unspecified address on systems where
  // Node defaults to IPv6. Explicit '0.0.0.0' matches the documented
  // Fly runtime contract.
  await app.listen(environment.API_PORT, '0.0.0.0');
}

export async function run(): Promise<void> {
  if (process.argv[2] === 'migrate') {
    try {
      await runMigrations();
      process.exit(0);
    } catch (error) {
      process.stderr.write(`Migration failed: ${String(error)}\n`);
      process.exit(1);
    }
  }

  await bootstrap();
}

const entryPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entryPath === fileURLToPath(import.meta.url)) {
  void run().catch((error: unknown) => {
    process.stderr.write(`Bootstrap failed: ${String(error)}\n`);
    process.exit(1);
  });
}
