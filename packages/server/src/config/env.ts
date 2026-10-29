/**
 * Environment configuration, validated once at boot.
 *
 * A misconfigured deployment fails at startup with a list of what is wrong,
 * rather than at 3am on the first request that touches the missing value. The
 * driver selections are also validated against each other: choosing the real
 * gateway without credentials is a configuration error, not a runtime surprise.
 */
import { z } from 'zod';
import { loadEnv } from './load-env.js';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

/** .env.example used to ship this exact value instead of a placeholder — any
 * environment ever bootstrapped by blindly copying that file encrypts every
 * stored credential (including the Zoho refresh token) under a key anyone
 * with read access to this repository's history already has. Refusing to
 * boot with it is a last line of defense against that history never
 * actually getting rotated out of a real deployment. */
const LEAKED_CREDENTIAL_ENCRYPTION_KEY = 'fG2F3Ahrw1zN97gZNFRAVdYSVQsnaw8IsM6RMaP/70U=';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'ci', 'development', 'staging', 'production']).default('local'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

    /** Each API is its own program on its own port (one per product). */
    PLATFORM_API_PORT: z.coerce.number().int().min(1).max(65_535).default(4001),
    SUGRPAY_API_PORT: z.coerce.number().int().min(1).max(65_535).default(4002),
    HQ_API_PORT: z.coerce.number().int().min(1).max(65_535).default(4003),

    /**
     * How the APIs reach each other's /internal routes — on the same machine,
     * never through the internet. INTERNAL_API_KEY is the shared secret those
     * routes require (required in production, at least 32 characters).
     */
    PLATFORM_INTERNAL_URL: z.string().url().default('http://127.0.0.1:4001'),
    SUGRPAY_INTERNAL_URL: z.string().url().default('http://127.0.0.1:4002'),
    INTERNAL_API_KEY: z.string().min(32).optional(),

    /**
     * Signs the mail delivery webhook (POST /public/webhooks/mail): whatever
     * posts delivery, bounce and complaint events shares this secret. Its own
     * value — never SESSION_SECRET. Unset: the webhook accepts nothing.
     */
    MAIL_WEBHOOK_SECRET: z.string().min(32).optional(),

    // One database per module. Each module's runtime connection uses its own
    // NON-owner role, which row-level security binds and which can reach no
    // other module's database; the DIRECT url is that database's owner,
    // used for migrations and deliberate cross-tenant work.
    PLATFORM_DATABASE_URL: z.string().url(),
    PLATFORM_DIRECT_DATABASE_URL: z.string().url().optional(),
    INVOICING_DATABASE_URL: z.string().url(),
    INVOICING_DIRECT_DATABASE_URL: z.string().url().optional(),
    REDIS_URL: z.string().url(),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    CREDENTIAL_ENCRYPTION_KEY: z
      .string()
      .min(1)
      .refine((v) => Buffer.from(v, 'base64').length === 32, {
        message: 'CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, base64 encoded',
      })
      .refine((v) => v !== LEAKED_CREDENTIAL_ENCRYPTION_KEY, {
        message:
          'CREDENTIAL_ENCRYPTION_KEY is the placeholder value that used to be committed in ' +
          '.env.example — generate a real one (openssl rand -base64 32) and rotate every ' +
          'credential this key has ever encrypted if this value was ever used in a real environment',
      }),

    PAYMENT_GATEWAY_DRIVER: z.enum(['fake', 'numbers', 'stripe']).default('fake'),
    ACCOUNTING_DRIVER: z.enum(['fake', 'zoho']).default('fake'),
    MAIL_DRIVER: z.enum(['smtp', 'postmark', 'console']).default('console'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    /** Implicit TLS from the first byte, which is what port 465 expects. Port
     * 587 uses STARTTLS instead and must leave this false. Defaults from the
     * port so the common cases need no thought. */
    SMTP_SECURE: booleanish.optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default('Sugrpay <billing@localhost>'),
    POSTMARK_SERVER_TOKEN: z.string().optional(),

    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    NUMBERS_API_BASE_URL: z.string().optional(),
    NUMBERS_API_KEY: z.string().optional(),
    NUMBERS_WEBHOOK_SECRET: z.string().optional(),

    // Stripe Connect (Standard, OAuth). These are the PLATFORM's own
    // credentials, and there is exactly one set — the inverse of the previous
    // arrangement, where each brand pasted its own secret key and webhook
    // secret and this file deliberately held none.
    //
    // Connect makes that inversion a simplification rather than a regression:
    // a brand authorises the platform instead of handing over a key, so the
    // only per-brand fact left is its account id (acct_…), which is not a
    // secret and lives in IntegrationConnection.config. The platform never
    // holds a credential capable of acting on a brand's account outside the
    // authorisation it granted, and revoking is a Stripe-side action the brand
    // controls. See StripeAccountService.
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    /** The Connect application id (ca_…) from the platform's Stripe settings. */
    STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
    /** Must exactly match a redirect URI registered on the Connect application. */
    STRIPE_CONNECT_REDIRECT_URI: z.string().optional(),
    /**
     * One endpoint secret for the whole platform. Connected-account events all
     * arrive at a single endpoint carrying `account: acct_…`, so there is no
     * longer a per-brand signing secret to collect or rotate.
     */
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // Square Connect (OAuth), per brand — the same shape as Stripe Connect
    // above: the platform's own application id/secret, and each brand
    // authorises on Square's consent screen rather than pasting a token.
    // See SquareAccountService.
    SQUARE_APPLICATION_ID: z.string().optional(),
    SQUARE_APPLICATION_SECRET: z.string().optional(),
    SQUARE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    /** Must exactly match a redirect URL registered on the Square application. */
    SQUARE_CONNECT_REDIRECT_URI: z.string().optional(),

    ZOHO_CLIENT_ID: z.string().optional(),
    ZOHO_CLIENT_SECRET: z.string().optional(),
    ZOHO_REDIRECT_URI: z.string().optional(),
    ZOHO_API_DOMAIN: z.string().default('https://www.zohoapis.com'),
    ZOHO_ACCOUNTS_DOMAIN: z.string().default('https://accounts.zoho.com'),
    /**
     * Shared secret this platform requires as a `?token=` query parameter on
     * every inbound Zoho Books webhook URL. Zoho Books webhooks carry no
     * standard request signature the way Stripe's do; the documented
     * mechanism it does offer is per-webhook static query/form parameters, so
     * this is set as one of those when the webhook is registered in Zoho
     * (Settings > Automation > Webhooks), alongside `organization_id` and
     * `event` — see ZohoWebhookController. Optional: per-organization tokens
     * are derived from this when set, else from SESSION_SECRET
     * (zoho-webhook-token.ts), and the value itself is still accepted as a
     * token for webhooks registered before those existed.
     */
    ZOHO_WEBHOOK_SECRET: z.string().optional(),

    /**
     * Whether the every-minute 'scheduled-sync' tick may pull from Zoho at
     * all, at each brand's own Sync Frequency (Real-time, the default, is
     * every 5 minutes on top of webhooks). Set it false to stop every timed
     * pull at once (e.g. while Zoho is rate-limiting an organisation).
     */
    ZOHO_SCHEDULED_PULL_ENABLED: booleanish.default(true),

    API_PUBLIC_URL: z.string().url().default('http://localhost:4001'),
    /** Signs the JWT a user carries into a product from Select Your Products
     * (POST /company/products/:product/continue). At least 32 characters;
     * required in production. */
    PRODUCT_JWT_SECRET: z.string().min(32).optional(),
    /** Where HQ's web app lives. Unset: HQ can be enabled, but Continue into
     * it answers "not available yet". */
    HQ_PUBLIC_URL: z.string().url().optional(),
    /** The Swagger page at /docs on every API (packages/server/src/api-docs.ts). */
    API_DOCS_ENABLED: booleanish.default(true),
    ADMIN_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
    /** Accounts (sign-in, team, billing). Set-password emails link here. */
    ACCOUNTS_PUBLIC_URL: z.string().url().default('http://localhost:3000/accounts'),
    PAYMENT_PUBLIC_URL: z.string().url().default('http://localhost:3000/pay'),
    /** Extra browser origins allowed to call the API (comma separated, e.g.
     * `https://main.xxxx.amplifyapp.com`). The origins of ADMIN_PUBLIC_URL,
     * ACCOUNTS_PUBLIC_URL and PAYMENT_PUBLIC_URL are always allowed; every
     * other website is refused by CORS (see corsOrigins in main.ts). */
    CORS_EXTRA_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().url())),

    /** How often each process polls the event outboxes for due events
     * (retries and anything a crashed process left behind). Producers also
     * flush right after committing, so this is not the delivery latency.
     * 0 disables polling (tests flush explicitly). */
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(0).default(1000),

    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    ENABLE_SCHEDULER: booleanish.default(true),
  })
  .superRefine((env, ctx) => {
    const require = (value: unknown, key: string, because: string) => {
      if (!value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required ${because}`,
        });
      }
    };

    if (env.PAYMENT_GATEWAY_DRIVER === 'numbers') {
      require(env.NUMBERS_API_BASE_URL, 'NUMBERS_API_BASE_URL', 'when PAYMENT_GATEWAY_DRIVER=numbers');
      require(env.NUMBERS_API_KEY, 'NUMBERS_API_KEY', 'when PAYMENT_GATEWAY_DRIVER=numbers');
      require(env.NUMBERS_WEBHOOK_SECRET, 'NUMBERS_WEBHOOK_SECRET', 'when PAYMENT_GATEWAY_DRIVER=numbers');
    }
    if (env.PAYMENT_GATEWAY_DRIVER === 'stripe') {
      const because = 'when PAYMENT_GATEWAY_DRIVER=stripe';
      require(env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY', because);
      require(env.STRIPE_PUBLISHABLE_KEY, 'STRIPE_PUBLISHABLE_KEY', because);
      require(env.STRIPE_CONNECT_CLIENT_ID, 'STRIPE_CONNECT_CLIENT_ID', because);
      require(env.STRIPE_CONNECT_REDIRECT_URI, 'STRIPE_CONNECT_REDIRECT_URI', because);
      require(env.STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET', because);
    }
    if (env.ACCOUNTING_DRIVER === 'zoho') {
      require(env.ZOHO_CLIENT_ID, 'ZOHO_CLIENT_ID', 'when ACCOUNTING_DRIVER=zoho');
      require(env.ZOHO_CLIENT_SECRET, 'ZOHO_CLIENT_SECRET', 'when ACCOUNTING_DRIVER=zoho');
      require(env.ZOHO_REDIRECT_URI, 'ZOHO_REDIRECT_URI', 'when ACCOUNTING_DRIVER=zoho');
    }
    if (env.STORAGE_DRIVER === 's3') {
      require(env.S3_BUCKET, 'S3_BUCKET', 'when STORAGE_DRIVER=s3');
    }
    // MAIL_DRIVER=postmark has no adapter bound (see MailModule). Left in the
    // enum so the intended provider stays visible, but refused here rather
    // than allowed to fall through to the console mailer — which in
    // production would boot happily and silently discard every message.
    if (env.MAIL_DRIVER === 'postmark') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_DRIVER'],
        message:
          'the Postmark adapter is not implemented yet — use MAIL_DRIVER=smtp, which speaks to ' +
          "Postmark, SES, Resend and any other provider's SMTP endpoint",
      });
    }

    // A fake adapter in production would silently swallow real money and real
    // customer email. Refuse to boot rather than discover it later.
    if (env.APP_ENV === 'production') {
      if (!env.PRODUCT_JWT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PRODUCT_JWT_SECRET'],
          message: 'users cannot continue into a product without PRODUCT_JWT_SECRET',
        });
      }
      if (!env.INTERNAL_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['INTERNAL_API_KEY'],
          message: 'the APIs cannot call each other without INTERNAL_API_KEY',
        });
      }
      if (env.PAYMENT_GATEWAY_DRIVER === 'fake') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PAYMENT_GATEWAY_DRIVER'],
          message: 'the fake payment gateway must never run in production',
        });
      }
      if (env.MAIL_DRIVER === 'console') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MAIL_DRIVER'],
          message: 'the console mailer must never run in production',
        });
      }
      if (env.STORAGE_DRIVER === 'local') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STORAGE_DRIVER'],
          message: 'local disk storage must never run in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  loadEnv();
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached environment. */
export function resetEnvCache(): void {
  cached = null;
}

export const ENV = Symbol('ENV');
