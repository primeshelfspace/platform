import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp, getEnv } from '@platform/server';
import { AppModule } from './app.module.js';
import { InvoicingPrismaService } from './modules/database/invoicing-prisma.service.js';
import { QueueService } from './infra/queue/queue.service.js';

/** The Sugrpay API (sugrpay-api.sugrpay.com). Background jobs run in worker.ts. */
async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = new Logger('sugrpay-api');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Gateway webhook signatures are computed over the exact bytes sent, not
    // over a re-serialised JSON body.
    rawBody: true,
    logger:
      env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
        ? ['error', 'warn', 'log', 'debug', 'verbose']
        : ['error', 'warn', 'log'],
  });
  configureApp(app, env, logger);
  app.enableShutdownHooks();

  await app.listen(env.SUGRPAY_API_PORT);

  // After listen, because that is what runs onModuleInit and therefore what
  // creates the queues this registers against.
  if (env.ENABLE_SCHEDULER) {
    await app.get(QueueService).registerScheduledJobs();
  }

  logger.log(`Sugrpay API on http://localhost:${env.SUGRPAY_API_PORT} (${env.APP_ENV})`);
  logger.log(
    `adapters — gateway: ${env.PAYMENT_GATEWAY_DRIVER}, accounting: ${env.ACCOUNTING_DRIVER}, ` +
      `mail: ${env.MAIL_DRIVER}, storage: ${env.STORAGE_DRIVER}`,
  );

  // A brand can be live-connected to Zoho (rows in zoho_connection) while
  // this process runs with ACCOUNTING_DRIVER=fake — a misconfigured env, not
  // a code path anything else catches, since AccountingModule's factory
  // picks the adapter once at boot with no further validation (see its own
  // comment). Every push would then silently go to FakeAccountingAdapter
  // instead of Zoho: not an error anywhere, just data that never arrives.
  // Logged loudly rather than refused at boot — this must not crash an
  // already-running deployment over what might be a deliberate staging
  // config with no real Zoho brands yet; accountingDriverMismatch on the
  // dashboard's integrations-status surfaces the same fact per-brand.
  if (env.ACCOUNTING_DRIVER !== 'zoho') {
    const prisma = app.get(InvoicingPrismaService);
    const connectedCount = await prisma.withoutScope(
      'boot check: counting live Zoho connections against the active accounting driver',
      (client) => client.zohoConnection.count({ where: { status: 'CONNECTED' } }),
    );
    if (connectedCount > 0) {
      logger.error(
        `MISCONFIGURATION: ${connectedCount} brand(s) have a CONNECTED Zoho Books connection, ` +
          `but ACCOUNTING_DRIVER=${env.ACCOUNTING_DRIVER} — every customer/invoice push is going ` +
          `to the fake adapter and NOT reaching Zoho. Set ACCOUNTING_DRIVER=zoho.`,
      );
    }
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
