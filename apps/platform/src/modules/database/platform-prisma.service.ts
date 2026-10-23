import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Scope } from '@platform/kernel';
import { ENV, type Env } from '@platform/server';
import { applyScope, isUniqueViolation, SCOPED_TRANSACTION_OPTIONS } from '@platform/server';
import { PrismaClient } from './client.js';

/** The transactional client handed to a scoped unit of work. */
export type ScopedClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * The platform database — connection lifecycle plus the third layer of tenant
 * isolation (TDD-001 §6.1). Only platform code may use this service; products
 * reach platform data through the platform's public API.
 *
 * `withScope` opens a transaction, pushes the request scope into PostgreSQL
 * session settings, and only then runs the caller's work. Row-level security
 * policies read those settings, so a repository that forgets its brand
 * predicate returns nothing rather than someone else's data.
 *
 * The runtime connection uses a NON-owner role (platform_app). An owner
 * bypasses RLS entirely, which would make the whole layer decorative.
 */
@Injectable()
export class PlatformPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformPrismaService.name);

  /**
   * Owner-role connection, used only by withoutScope. app_merchant_id() and
   * friends return NULL with no scope set, and every RLS policy reads "NULL
   * means deny" — so unscoped work on the RLS-bound connection would just see
   * nothing. The owner bypasses RLS by construction; it is also the
   * connection the event outbox is delivered from.
   */
  private readonly unscopedClient: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    super({
      datasources: { db: { url: env.PLATFORM_DATABASE_URL } },
      log:
        env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['warn', 'error'],
    });

    if (!env.PLATFORM_DIRECT_DATABASE_URL) {
      this.logger.warn(
        'PLATFORM_DIRECT_DATABASE_URL is not set — withoutScope will run on the RLS-bound ' +
          'connection and silently return nothing for any protected table.',
      );
    }
    this.unscopedClient = new PrismaClient({
      datasources: {
        db: { url: env.PLATFORM_DIRECT_DATABASE_URL ?? env.PLATFORM_DATABASE_URL },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.unscopedClient.$connect();
    this.logger.log('platform database connection established');
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
    return this.$transaction(async (tx) => {
      await applyScope(tx, scope);
      return work(tx as unknown as ScopedClient);
    }, SCOPED_TRANSACTION_OPTIONS);
  }

  /**
   * Escape hatch for work that is genuinely cross-tenant: reconciliation
   * jobs, platform administration, event delivery. Named to be conspicuous
   * in review, and every call site is expected to justify itself.
   */
  async withoutScope<T>(reason: string, work: (client: PrismaClient) => Promise<T>): Promise<T> {
    this.logger.warn(`unscoped database access: ${reason}`);
    return work(this.unscopedClient);
  }

  /** The owner connection for the outbox dispatcher, which runs constantly
   * and would otherwise flood the log through withoutScope's warning. */
  get ownerClient(): PrismaClient {
    return this.unscopedClient;
  }

  /** True when the error is a unique-constraint violation on `target`. */
  static isUniqueViolation(error: unknown, target?: string): boolean {
    return isUniqueViolation(error, target);
  }
}
