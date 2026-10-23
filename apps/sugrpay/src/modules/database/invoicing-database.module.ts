import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { HealthChecks } from '@platform/server';
import { InvoicingPrismaService } from './invoicing-prisma.service.js';

/** Global so every invoicing module can inject the invoicing database. No
 * other module can import InvoicingPrismaService — it is not part of the
 * invoicing public API (enforced by src/module-boundaries.test.ts). */
@Global()
@Module({
  providers: [InvoicingPrismaService],
  exports: [InvoicingPrismaService],
})
export class InvoicingDatabaseModule implements OnModuleInit {
  constructor(
    private readonly prisma: InvoicingPrismaService,
    private readonly health: HealthChecks,
  ) {}

  onModuleInit(): void {
    this.health.register('postgres:invoicing', () => this.prisma.ping());
  }
}
