import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker, type Job } from 'bullmq';
import { AppModule } from './app.module.js';
import { getEnv } from './config/env.js';
import { PrismaService } from './infra/prisma/prisma.service.js';
import { QueueService } from './infra/queue/queue.service.js';
import { RedisService } from './infra/redis/redis.service.js';
import { QUEUES, QUEUE_NAMES, type QueueName } from './infra/queue/queues.js';
import { ZohoPullService } from './integrations/zoho-pull.service.js';
import { ZohoSyncService } from './integrations/zoho-sync.service.js';

/**
 * How long a SyncJob may sit in RUNNING before it is treated as abandoned
 * rather than slow. See the reaper in the 'scheduled-sync' handler for why this
 * exists and why thirty minutes is the right side of every legitimate job.
 */
const STALE_SYNC_JOB_MS = 30 * 60 * 1000;

/**
 * Worker entry point.
 *
 * One process hosts all six pools today; each queue keeps its own concurrency,
 * so priority is already structural and a pool can be split into its own
 * deployment later without changing any producer.
 *
 * Handlers are registered per queue as the corresponding feature lands. An
 * unhandled job name fails loudly rather than being silently acknowledged —
 * a silently dropped payment event is the worst outcome available here.
 */
type Handler = (job: Job) => Promise<unknown>;

const handlers: Partial<Record<QueueName, Record<string, Handler>>> = {
  // Populated by feature modules: payment-events, mail, sync, documents,
  // scheduled, insights.
};

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = new Logger('worker');

  // A full application context, so handlers get the same services, adapters and
  // scoped database access the API has.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const redis = app.get(RedisService);

  // FR-ZHO-011/012 (push) and FR-ZHO-030 (pull): a brand with no Zoho
  // connection is a no-op inside each push method, not a failure, so an
  // unconnected brand's jobs succeed and drain quietly.
  const zohoSync = app.get(ZohoSyncService);
  const zohoPull = app.get(ZohoPullService);
  const prisma = app.get(PrismaService);
  const queue = app.get(QueueService);

  handlers.sync = {
    'zoho-push-customer': (job) => zohoSync.pushCustomer(job.data.brandId, job.data.customerId),
    'zoho-push-invoice': (job) => zohoSync.pushInvoice(job.data.brandId, job.data.invoiceId),
    'zoho-push-payment': (job) => zohoSync.pushPayment(job.data.brandId, job.data.paymentId),
    // force is set only by the on-demand "pull now" endpoint
    // (zoho-connect.controller.ts) — it bypasses pullBrand's contacts
    // full-scan floor, which the scheduled tick below must never do.
    'zoho-pull-brand': (job) => zohoPull.pullBrand(job.data.brandId, job.data.force === true),
  };

  // The 'scheduled-sync' repeatable job (queues.ts, registered by the API
  // process via QueueService.registerScheduledJobs) ticks every minute — that
  // is just this handler's own resolution, not any one brand's cadence. Each
  // tick lists every live Zoho connection and enqueues a pull only for the
  // brands actually due, per their own pullFrequencyMinutes (FR-ZHO-030); a
  // brand configured for "Daily" is skipped on the other 1,439 ticks.
  handlers.scheduled = {
    'scheduled-sync': async () => {
      // G-11. A SyncJob row is set RUNNING before its work starts and moved to
      // SUCCEEDED/SKIPPED/FAILED after, so a process that dies mid-job — a
      // deploy, an OOM kill, a crash — leaves the row RUNNING with nothing that
      // will ever transition it. They accumulate silently and, because the
      // integrations panel shows the most recent rows, eventually crowd out the
      // real activity with jobs that are permanently "in flight".
      //
      // Thirty minutes is comfortably longer than any legitimate job: the
      // per-record pulls are single API calls, the list scans are bounded by the
      // rate limiter, and BullMQ's own retry budget for this queue is about the
      // same span — so anything still RUNNING past it is not slow, it is gone.
      // Guarded: reaping is housekeeping, and it runs before the part of this
      // tick that actually enqueues pulls. Letting it throw would mean no brand
      // syncs at all this tick — trading a cosmetic backlog of stale rows for
      // real data going stale.
      let reapedCount = 0;
      try {
        const reaped = await prisma.withoutScope(
          'scheduled-sync: failing sync jobs orphaned by a crashed worker',
          (client) =>
            client.syncJob.updateMany({
              where: {
                status: 'RUNNING',
                createdAt: { lt: new Date(Date.now() - STALE_SYNC_JOB_MS) },
              },
              data: {
                status: 'FAILED',
                errorClass: 'PERMANENT',
                lastError: 'abandoned — the worker processing this job stopped before finishing it',
              },
            }),
        );
        reapedCount = reaped.count;
        if (reapedCount > 0) {
          logger.warn(`scheduled-sync: failed ${reapedCount} sync job(s) orphaned by a crash`);
        }
      } catch (error) {
        logger.warn(
          `scheduled-sync: could not reap orphaned sync jobs, continuing to the pull scan: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const connections = await prisma.withoutScope(
        'scheduled-sync: listing brands with a live Zoho connection',
        (client) =>
          client.integrationConnection.findMany({
            where: {
              provider: 'ZOHO_BOOKS',
              status: 'CONNECTED',
              encryptedCredentials: { not: null },
            },
            select: { brandId: true, lastPulledAt: true, pullFrequencyMinutes: true },
          }),
      );
      const now = Date.now();
      const due = connections.filter(
        (c) => !c.lastPulledAt || now - c.lastPulledAt.getTime() >= c.pullFrequencyMinutes * 60_000,
      );
      await Promise.all(
        due.map(({ brandId }) => queue.enqueue('sync', 'zoho-pull-brand', { brandId })),
      );
      return {
        brandsConnected: connections.length,
        brandsEnqueued: due.length,
        staleJobsReaped: reapedCount,
      };
    },
  };

  const workers = QUEUE_NAMES.map((name) => {
    const definition = QUEUES[name];
    const worker = new Worker(
      name,
      async (job) => {
        const handler = handlers[name]?.[job.name];
        if (!handler) {
          // Still a hard failure — a silently acknowledged payment event is the
          // worst outcome available here. For a repeatable, reaching this means
          // queues.ts and this file disagree: mark the job `implemented: false`
          // there (which also sweeps it out of Redis) or add its handler below.
          throw new Error(
            `no handler registered for ${name}/${job.name} — ` +
              'add one here, or set implemented: false in queues.ts if it is a scheduled job',
          );
        }
        return handler(job);
      },
      {
        connection: redis.createQueueConnection(`worker-${name}`),
        concurrency: Math.min(definition.concurrency, env.WORKER_CONCURRENCY),
      },
    );

    worker.on('failed', (job, error) => {
      logger.error(`${name}/${job?.name ?? 'unknown'} failed: ${error.message}`);
    });
    worker.on('error', (error) => logger.error(`${name} worker error: ${error.message}`));

    return worker;
  });

  logger.log(`workers running: ${QUEUE_NAMES.join(', ')}`);

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, draining workers`);
    await Promise.allSettled(workers.map((w) => w.close()));
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
