import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ACCOUNTING_PORT, PAYMENT_GATEWAY_PORT, STORAGE_PORT } from '@fenwick/shared';
import type { AccountingPort, PaymentGatewayPort, StoragePort } from '@fenwick/shared';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RedisService } from '../infra/redis/redis.service.js';
import { QueueService } from '../infra/queue/queue.service.js';
import { Public } from '../tenancy/authorisation.js';

type CheckState = 'up' | 'down' | 'skipped';

interface CheckResult {
  readonly name: string;
  readonly state: CheckState;
  readonly durationMs: number;
  readonly detail?: string;
}

/**
 * Liveness and readiness.
 *
 * They are separate on purpose: liveness answers "is this process wedged", and
 * a dependency outage must not cause the orchestrator to restart a process that
 * is working perfectly well. Readiness answers "should traffic come here", and
 * that one does depend on Postgres and Redis.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(ACCOUNTING_PORT) private readonly accounting: AccountingPort,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
  ) {}

  @Public()
  @Get()
  async summary(@Res() response: Response): Promise<void> {
    const checks = await Promise.all([
      this.check('postgres', () => this.prisma.ping()),
      this.check('redis', () => this.redis.ping()),
      this.check('queues', async () => {
        await this.queues.counts();
        return true;
      }),
      this.check('storage', async () => {
        // A write, not a head: heading a key that need not exist is not a
        // reliable proof of access under least-privilege S3 credentials
        // (TDD-001 §15.2) — without s3:ListBucket, S3 answers a missing key
        // with 403, identical to a real permission failure, so that check
        // could never tell "storage is fine, this key just doesn't exist"
        // apart from "storage is actually broken". A write exercises the one
        // permission every upload path actually depends on.
        await this.storage.put({
          key: '.healthcheck',
          body: Buffer.from(new Date().toISOString()),
          contentType: 'text/plain',
        });
        return true;
      }),
    ]);

    const ready = checks.every((c) => c.state !== 'down');
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      environment: this.env.APP_ENV,
      adapters: {
        paymentGateway: this.gateway.providerName,
        accounting: this.accounting.providerName,
        storage: this.storage.providerName,
        mail: this.env.MAIL_DRIVER,
      },
      checks,
      checkedAt: new Date().toISOString(),
    });
  }

  @Public()
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready(@Res() response: Response): Promise<void> {
    const checks = await Promise.all([
      this.check('postgres', () => this.prisma.ping()),
      this.check('redis', () => this.redis.ping()),
    ]);
    const ready = checks.every((c) => c.state === 'up');
    response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready', checks });
  }

  @Public()
  @Get('queues')
  async queueDepths(): Promise<Record<string, Record<string, number>>> {
    return this.queues.counts();
  }

  private async check(name: string, probe: () => Promise<unknown>): Promise<CheckResult> {
    const started = Date.now();
    try {
      await probe();
      return { name, state: 'up', durationMs: Date.now() - started };
    } catch (error) {
      return {
        name,
        state: 'down',
        durationMs: Date.now() - started,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
