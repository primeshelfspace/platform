import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { type Scope, databaseScopeSettings } from '@sugrpay/shared';
import { ENV, type Env } from '../../config/env.js';

/** The transactional client handed to a scoped unit of work. */
export type ScopedClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * PrismaService — connection lifecycle plus the third layer of tenant
 * isolation (TDD-001 §6.1).
 *
 * `withScope` opens a transaction, pushes the request scope into PostgreSQL
 * session settings, and only then runs the caller's work. Row-level security
 * policies read those settings, so a repository that forgets its brand
 * predicate returns nothing rather than someone else's data.
 *
 * The runtime connection uses a NON-owner role. An owner bypasses RLS entirely,
 * which would make the whole layer decorative.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Owner-role connection, used only by withoutScope. app_merchant_id() and
   * friends return NULL with no scope set, and every RLS policy here reads
   * "NULL means deny" — so running unscoped work on the app's own DATABASE_URL
   * connection (sugrpay_app, RLS-bound) doesn't bypass RLS, it just makes every
   * protected table return nothing. Table owners bypass RLS by construction;
   * DIRECT_DATABASE_URL already exists for Prisma's migration tooling and is
   * the same owner role, so it doubles as the one true escape hatch.
   */
  private readonly unscopedClient: PrismaClient;

  constructor(@Inject(ENV) private readonly env: Env) {
    super({
      datasources: { db: { url: env.DATABASE_URL } },
      log:
        env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['warn', 'error'],
    });

    if (!env.DIRECT_DATABASE_URL) {
      this.logger.warn(
        'DIRECT_DATABASE_URL is not set — withoutScope will run on the RLS-bound connection ' +
          'and silently return nothing for any protected table. Set it for the public payment ' +
          'path and any cross-tenant job to work at all.',
      );
    }
    this.unscopedClient = new PrismaClient({
      datasources: { db: { url: env.DIRECT_DATABASE_URL ?? env.DATABASE_URL } },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.unscopedClient.$connect();
    this.logger.log('database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.unscopedClient.$disconnect();
  }

  /** Cheap liveness probe for the health endpoint. */
  async ping(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }

  /**
   * Runs `work` inside a transaction with the tenant scope applied to the
   * database session. Every read and write that must be tenant-isolated goes
   * through here — there is no unscoped path to application data.
   */
  async withScope<T>(scope: Scope, work: (tx: ScopedClient) => Promise<T>): Promise<T> {
    const settings = databaseScopeSettings(scope);

    return this.$transaction(
      async (tx) => {
        // set_config with is_local = true scopes the setting to this transaction,
        // so a pooled connection cannot leak one request's scope into the next.
        for (const [key, value] of Object.entries(settings)) {
          await tx.$executeRaw`SELECT set_config(${key}, ${value}, true)`;
        }
        return work(tx as unknown as ScopedClient);
      },
      // Prisma's own interactive-transaction options default to maxWait: 2s
      // (time allowed just to acquire a pooled connection and start) and
      // timeout: 5s (time allowed for the transaction body to run) — both
      // separate from connect_timeout/pool_timeout on DATABASE_URL. This
      // Neon compute's per-query latency can exceed either default; 30s
      // matches the headroom already given to connection setup elsewhere.
      { maxWait: 30_000, timeout: 30_000 },
    );
  }

  /**
   * Escape hatch for work that is genuinely cross-tenant: migrations,
   * reconciliation jobs, platform administration. Named to be conspicuous in
   * review, and every call site is expected to justify itself. Runs on the
   * owner-role connection specifically because RLS denies by default —
   * see the constructor note on unscopedClient.
   */
  async withoutScope<T>(reason: string, work: (client: PrismaClient) => Promise<T>): Promise<T> {
    this.logger.warn(`unscoped database access: ${reason}`);
    return work(this.unscopedClient);
  }

  /** True when the error is a unique-constraint violation on `target`. */
  static isUniqueViolation(error: unknown, target?: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code !== 'P2002') return false;
    if (!target) return true;
    const fields = error.meta?.['target'];
    return Array.isArray(fields) ? fields.includes(target) : fields === target;
  }
}
