import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnvironment } from '../../../config/env.js';
import { DATABASE_TOKEN, type DatabaseState, initializeDatabase } from './client.js';

@Injectable()
class PoolShutdown implements OnApplicationShutdown {
  public constructor(@Inject(DATABASE_TOKEN) public readonly state: DatabaseState) {}

  public async onApplicationShutdown(): Promise<void> {
    // Close the pool so Postgres connections release cleanly on Fly
    // shutdown / test teardown / hot reload — otherwise pg clients stay
    // alive until the process is force-killed, leaking fds and breaking
    // subsequent boots.
    await this.state.pool.end().catch((error: unknown) => {
      console.error('[pg pool] error during shutdown:', error);
    });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_TOKEN,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<AppEnvironment, true>): Promise<DatabaseState> =>
        initializeDatabase({
          databaseUrl: config.getOrThrow('DATABASE_URL'),
        }),
    },
    PoolShutdown,
  ],
  exports: [DATABASE_TOKEN],
})
export class DatabaseModule {
  // NestJS auto-instantiates PoolShutdown; its OnApplicationShutdown hook
  // closes the pool on graceful shutdown.
}
