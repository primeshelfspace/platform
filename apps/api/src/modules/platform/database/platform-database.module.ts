import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { HealthChecks } from '../../../shared/health/health-checks.js';
import { PlatformPrismaService } from './platform-prisma.service.js';

/** Global so every platform module can inject the platform database. Other
 * modules cannot import PlatformPrismaService at all — it is not part of the
 * platform's public API (enforced by src/module-boundaries.test.ts). */
@Global()
@Module({
  providers: [PlatformPrismaService],
  exports: [PlatformPrismaService],
})
export class PlatformDatabaseModule implements OnModuleInit {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly health: HealthChecks,
  ) {}

  onModuleInit(): void {
    this.health.register('postgres:platform', () => this.prisma.ping());
  }
}
