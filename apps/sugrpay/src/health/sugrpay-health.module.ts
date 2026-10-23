import { Controller, Get, Inject, Module, type OnModuleInit } from '@nestjs/common';
import {
  ACCOUNTING_PORT,
  PAYMENT_GATEWAY_PORT,
  type AccountingPort,
  type PaymentGatewayPort,
} from '@platform/kernel';
import { HealthChecks, Public } from '@platform/server';
import { AccountingModule } from '../adapters/accounting/accounting.module.js';
import { GatewayModule } from '../adapters/gateway/gateway.module.js';
import { QueueService } from '../infra/queue/queue.service.js';

/** Queue depths, for operators (Sugrpay owns every background job). */
@Controller('health')
export class QueueHealthController {
  constructor(private readonly queues: QueueService) {}

  @Public()
  @Get('queues')
  queueDepths(): Promise<Record<string, Record<string, number>>> {
    return this.queues.counts();
  }
}

/**
 * Adds Sugrpay's own parts to the shared /health report: the job queues, and
 * which payment gateway and accounting adapters this API runs with.
 */
@Module({ imports: [GatewayModule, AccountingModule], controllers: [QueueHealthController] })
export class SugrpayHealthModule implements OnModuleInit {
  constructor(
    private readonly health: HealthChecks,
    private readonly queues: QueueService,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
    @Inject(ACCOUNTING_PORT) private readonly accounting: AccountingPort,
  ) {}

  onModuleInit(): void {
    this.health.register('queues', () => this.queues.counts());
    this.health.describeAdapter('paymentGateway', this.gateway.providerName);
    this.health.describeAdapter('accounting', this.accounting.providerName);
  }
}
