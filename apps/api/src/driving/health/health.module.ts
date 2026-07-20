import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../adapters/persistence/drizzle/database.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
})
export class HealthModule {}
