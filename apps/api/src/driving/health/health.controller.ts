import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';

import { DATABASE_TOKEN, type DatabaseState } from '../../adapters/persistence/drizzle/client.js';
import type { AppEnvironment } from '../../config/env.js';

type DeepCheck = {
  readonly name: string;
  readonly run: () => Promise<void>;
};

type HealthBody = {
  readonly status: 'ok' | 'degraded';
  readonly db: 'up' | 'down';
  readonly uptime_s: number;
  readonly memory?: NodeJS.MemoryUsage;
};

// Single source of truth for the check names — the controller's body field
// selector and the check declaration both reference this. Renaming a check
// (e.g. for Story 2.3's provider sub-check) must update exactly one place.
const CHECK_NAMES = {
  database: 'database',
} as const;

@Controller()
export class HealthController {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly database: DatabaseState,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  @Get('healthz')
  @SkipThrottle()
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('health')
  async health(@Res({ passthrough: true }) response: Response): Promise<HealthBody> {
    const checks = await Promise.all(
      this.deepChecks().map(async (check) => ({
        name: check.name,
        ok: await this.runCheck(check),
      })),
    );
    const databaseUp = checks.find((check) => check.name === CHECK_NAMES.database)?.ok ?? false;
    const body: {
      status: 'ok' | 'degraded';
      db: 'up' | 'down';
      uptime_s: number;
      memory?: NodeJS.MemoryUsage;
    } = {
      status: databaseUp ? 'ok' : 'degraded',
      db: databaseUp ? 'up' : 'down',
      uptime_s: Math.floor(process.uptime()),
    };

    if (this.config.get('NODE_ENV') !== 'production') {
      body.memory = process.memoryUsage();
    }

    response.statusCode = databaseUp ? 200 : 503;
    return body;
  }

  private deepChecks(): readonly DeepCheck[] {
    return [
      {
        name: CHECK_NAMES.database,
        run: async () => {
          await this.database.db.execute(sql`SELECT 1`);
        },
      },
    ];
  }

  private async runCheck(check: DeepCheck): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('health check timed out')), 2_000);
    });

    try {
      await Promise.race([check.run(), timeoutPromise]);
      return true;
    } catch (error) {
      // Distinguish timeout from query failure in logs (story 1.6 replaces
      // console with pino). The boolean stays the same; the operator sees
      // a clear signal either way.
      console.warn(`[health] check ${check.name} failed:`, (error as Error).message);
      return false;
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
