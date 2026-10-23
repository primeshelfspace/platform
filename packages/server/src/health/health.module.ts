import { Global, Module } from '@nestjs/common';
import { StorageModule } from '../adapters/storage/storage.module.js';
import { HealthChecks } from './health-checks.js';
import { HealthController } from './health.controller.js';

/** Global so any module can register its own readiness probe. */
@Global()
@Module({
  imports: [StorageModule],
  controllers: [HealthController],
  providers: [HealthChecks],
  exports: [HealthChecks],
})
export class HealthModule {}
