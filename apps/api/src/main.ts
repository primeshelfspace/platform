import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { getEnv } from './shared/config/env.js';
import { configureApp } from './app-setup.js';
import { QueueService } from './shared/infra/queue/queue.service.js';

/**
 * API entry point. Workers run in a separate process (worker.ts) so a slow PDF
 * render or a Zoho outage cannot consume capacity the request path needs.
 */
async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), {
    // Gateway webhook signatures are computed over the exact bytes sent, not
    // over a re-serialised JSON body — rawBody exposes those bytes on
    // request.rawBody while the parsed body remains available as usual.
    rawBody: true,
    logger:
      env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
        ? ['error', 'warn', 'log', 'debug', 'verbose']
        : ['error', 'warn', 'log'],
  });

  configureApp(app, env, logger);

  app.enableShutdownHooks();

  await app.listen(env.API_PORT);

  // After listen, because that is what runs onModuleInit and therefore what
  // creates the queues this registers against.
  if (env.ENABLE_SCHEDULER) {
    await app.get(QueueService).registerScheduledJobs();
  }

  logger.log(`api listening on http://localhost:${env.API_PORT} (${env.APP_ENV})`);
  logger.log(
    `adapters — gateway: ${env.PAYMENT_GATEWAY_DRIVER}, accounting: ${env.ACCOUNTING_DRIVER}, ` +
      `mail: ${env.MAIL_DRIVER}, storage: ${env.STORAGE_DRIVER}`,
  );
}

bootstrap().catch((error: unknown) => {
  // Configuration and connection failures land here. Print and exit non-zero
  // rather than leaving a half-started process that answers nothing.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
