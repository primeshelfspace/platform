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
 * The HQ database — connection lifecycle plus the third layer of tenant
 * isolation (TDD-001 §6.1), exactly as Sugrpay's InvoicingPrismaService. Only
 * HQ code may use this service.
 *
 * The scope comes from the platform (session resolution happens there); this
 * service pushes it into HQ's own transaction, where row-level security
 * checks it against HQ's read-only copy of the brands. The runtime connection
 * uses a NON-owner role (hq_app), which holds no write grant on the copy.
 */
@Injectable()
export class HqPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HqPrismaService.name);

  /** Owner-role connection, used only by withoutScope and event handlers. */
  private readonly unscopedClient: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    if (!env.HQ_DATABASE_URL) {
      throw new Error(
        'HQ_DATABASE_URL is not set: the HQ API needs its own database ' +
          '(see deploy/production/add-hq-database.sh).',
      );
    }
    super({
      datasources: { db: { url: env.HQ_DATABASE_URL } },
      log:
        env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['warn', 'error'],
    });

    if (!env.HQ_DIRECT_DATABASE_URL) {
      this.logger.warn(
        'HQ_DIRECT_DATABASE_URL is not set — withoutScope and the brand copy run on the ' +
          'RLS-bound connection, which may not write the copy.',
      );
    }
    this.unscopedClient = new PrismaClient({
      datasources: { db: { url: env.HQ_DIRECT_DATABASE_URL ?? env.HQ_DATABASE_URL } },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.unscopedClient.$connect();
    this.logger.log('hq database connection established');
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

  /** Escape hatch for genuinely cross-tenant work. Every call site justifies
   * itself in `reason`. */
  async withoutScope<T>(reason: string, work: (client: PrismaClient) => Promise<T>): Promise<T> {
    this.logger.warn(`unscoped database access: ${reason}`);
    return work(this.unscopedClient);
  }

  /** The owner connection for event handlers, which run on every delivery. */
  get ownerClient(): PrismaClient {
    return this.unscopedClient;
  }

  static isUniqueViolation(error: unknown, target?: string): boolean {
    return isUniqueViolation(error, target);
  }
}
