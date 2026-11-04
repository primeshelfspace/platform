import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { HealthChecks } from '@platform/server';
import { HqPrismaService } from './hq-prisma.service.js';

/** Global so every HQ module can inject the HQ database. No other API can
 * reach it: it is HQ's alone. */
@Global()
@Module({
  providers: [HqPrismaService],
  exports: [HqPrismaService],
})
export class HqDatabaseModule implements OnModuleInit {
  constructor(
    private readonly prisma: HqPrismaService,
    private readonly health: HealthChecks,
  ) {}

  onModuleInit(): void {
    this.health.register('postgres:hq', () => this.prisma.ping());
  }
}
