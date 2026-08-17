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

  // origin: true reflects back whatever Origin header the caller sends,
  // rather than checking it against ADMIN_PUBLIC_URL/PAYMENT_PUBLIC_URL/an
  // allowlist. It's deliberately not a literal '*' — browsers reject a
  // wildcard origin once credentials are involved, and this app sends
  // session cookies, so reflection is what's required to accept every
  // origin AND keep credentials working. Net effect: any website can now
  // make a credentialed request to this API carrying a signed-in merchant's
  // own session cookie — there is no longer a per-origin allowlist guarding
  // that. Requested explicitly; see chat history for the tradeoff.
  app.enableCors({
    origin: true,
    credentials: true,
  });
  logger.log('cors: reflecting all origins, credentials enabled (no allowlist)');

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
