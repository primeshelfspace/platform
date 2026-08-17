import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { getEnv } from './config/env.js';
import { QueueService } from './infra/queue/queue.service.js';

// Prisma's BigInt columns (every *Minor money field) come back from the
// client as native bigint, which JSON.stringify cannot serialise at all.
// The domain's own Minor type is `number` throughout (TDD-001 §9.1) — bigint
// is a Postgres storage detail, not the application's representation of
// money — so this is safe exactly because assertMinor already guarantees
// every value fits in Number.MAX_SAFE_INTEGER before it reaches a bigint
// column. One global fix here beats converting by hand at every call site.
(BigInt.prototype as unknown as { toJSON(): number }).toJSON = function (this: bigint): number {
  return Number(this);
};

/**
 * API entry point. Workers run in a separate process (worker.ts) so a slow PDF
 * render or a Zoho outage cannot consume capacity the request path needs.
 */
async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create(AppModule, {
    // Gateway webhook signatures are computed over the exact bytes sent, not
    // over a re-serialised JSON body — rawBody exposes those bytes on
    // request.rawBody while the parsed body remains available as usual.
    rawBody: true,
    logger:
      env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
        ? ['error', 'warn', 'log', 'debug', 'verbose']
        : ['error', 'warn', 'log'],
  });

  // Validation is per-handler with ZodValidationPipe rather than a global
  // ValidationPipe: Zod is the stack's validation layer and the schemas are
  // shared with the browser, so there is no class-decorator definition to
  // validate against here.

  // Both web apps are separate origins and send session cookies. Deduped in
  // case ADMIN_PUBLIC_URL/PAYMENT_PUBLIC_URL and CORS_ALLOWED_ORIGINS overlap.
  const corsOrigins = [
    env.ADMIN_PUBLIC_URL,
    env.PAYMENT_PUBLIC_URL,
    ...(env.CORS_ALLOWED_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? []),
  ];
  app.enableCors({
    origin: [...new Set(corsOrigins)],
    credentials: true,
  });
  // Logged unconditionally (not just at debug level): a request blocked by
  // CORS fails silently in the browser with no server-side trace at all, so
  // this is often the only place a host mismatch is visible after the fact.
  logger.log(`cors allowed origins: ${corsOrigins.join(', ')}`);

  // Trust the proxy so request.ip is the client address in the audit log
  // rather than the load balancer's.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

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
