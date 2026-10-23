import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp, getEnv } from '@platform/server';
import { AppModule } from './app.module.js';

/** The platform API (platform-api.sugrpay.com). */
async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = new Logger('platform-api');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Webhook signatures are computed over the exact bytes sent.
    rawBody: true,
    logger:
      env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
        ? ['error', 'warn', 'log', 'debug', 'verbose']
        : ['error', 'warn', 'log'],
  });
  configureApp(app, env, logger);
  app.enableShutdownHooks();

  await app.listen(env.PLATFORM_API_PORT);
  logger.log(`platform API on http://localhost:${env.PLATFORM_API_PORT} (${env.APP_ENV})`);
}

bootstrap().catch((error: unknown) => {
  // Configuration and connection failures land here. Print and exit non-zero
  // rather than leaving a half-started process that answers nothing.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
