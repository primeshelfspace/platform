import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker, type Job } from 'bullmq';
import { AppModule } from './app.module.js';
import { RedisService, getEnv } from '@platform/server';
import { QUEUES, QUEUE_NAMES, type QueueName } from './infra/queue/queues.js';
import {
  ZohoPullService,
  ZohoScheduledSyncService,
  ZohoSyncService,
} from './modules/public-api.js';

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

  {
    // FR-ZHO-011/012 (push) and FR-ZHO-030 (pull): a brand with no Zoho
    // connection is a no-op inside each push method, not a failure, so an
    // unconnected brand's jobs succeed and drain quietly.
    const zohoSync = app.get(ZohoSyncService);
    const zohoPull = app.get(ZohoPullService);

    handlers.sync = {
      'zoho-push-customer': (job) => zohoSync.pushCustomer(job.data.brandId, job.data.customerId),
      'zoho-push-invoice': (job) => zohoSync.pushInvoice(job.data.brandId, job.data.invoiceId),
      'zoho-push-payment': (job) => zohoSync.pushPayment(job.data.brandId, job.data.paymentId),
      // force is set only by the on-demand "pull now" endpoint
      // (zoho-connect.controller.ts) — it bypasses pullBrand's contacts
      // full-scan floor, which the scheduled tick below must never do.
      'zoho-pull-brand': (job) => zohoPull.pullBrand(job.data.brandId, job.data.force === true),
    };

    // The every-minute 'scheduled-sync' tick: reaps orphaned sync jobs and
    // enqueues the Zoho pulls that are due. Invoicing logic, so it lives in
    // the invoicing module (ZohoScheduledSyncService).
    const scheduledSync = app.get(ZohoScheduledSyncService);
    handlers.scheduled = {
      'scheduled-sync': () => scheduledSync.tick(),
    };
  }

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
