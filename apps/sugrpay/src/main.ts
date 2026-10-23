import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp, getEnv } from '@platform/server';
import { AppModule } from './app.module.js';
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
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
