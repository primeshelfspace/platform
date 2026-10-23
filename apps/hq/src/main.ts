import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp, getEnv } from '@platform/server';
import { AppModule } from './app.module.js';

/** The HQ API (hq-api.sugrpay.com) — a skeleton until HQ is built. */
async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = new Logger('hq-api');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  configureApp(app, env, logger);
  app.enableShutdownHooks();
  await app.listen(env.HQ_API_PORT);
  logger.log(`HQ API on http://localhost:${env.HQ_API_PORT} (${env.APP_ENV})`);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
