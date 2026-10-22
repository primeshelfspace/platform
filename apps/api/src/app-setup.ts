import type { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from './shared/config/env.js';
import { corsOrigins, securityHeaders } from './shared/common/http-security.js';

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
 * Everything about the HTTP layer that is not a controller: body parsers,
 * which browser origins may call the API, proxy trust and the headers every
 * response carries. Shared by main.ts and the end-to-end tests, so the tests
 * exercise the API exactly as it runs in production.
 */
export function configureApp(app: NestExpressApplication, env: Env, logger?: Logger): void {
  // Zoho Books can be configured to send a webhook's raw JSON as text/plain,
  // which neither of Nest's default parsers (json, urlencoded) reads — the
  // body would arrive empty. ZohoWebhookController parses the text itself.
  app.useBodyParser('text', { type: 'text/plain' });

  // Validation is per-handler with ZodValidationPipe rather than a global
  // ValidationPipe: Zod is the stack's validation layer and the schemas are
  // shared with the browser, so there is no class-decorator definition to
  // validate against here.

  // Only the web app's own addresses may call this API from a browser. Any
  // other website gets no CORS headers, so the browser refuses to let its
  // scripts read our responses or send credentialed requests. (Server-to-
  // server calls — the web app's server, webhooks — carry no Origin and are
  // unaffected; authorization never depends on CORS.)
  const allowedOrigins = corsOrigins(env);
  app.enableCors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
  });
  logger?.log(`cors: allowing ${[...allowedOrigins].join(', ')}`);

  const http = app.getHttpAdapter().getInstance();
  // Trust the proxy so request.ip is the client address in the audit log
  // rather than the load balancer's.
  http.set('trust proxy', 1);
  // Do not advertise the framework.
  http.disable('x-powered-by');
  http.use(securityHeaders);
}
