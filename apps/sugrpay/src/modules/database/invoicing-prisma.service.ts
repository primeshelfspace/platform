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
 * The invoicing database — connection lifecycle plus the third layer of
 * tenant isolation (TDD-001 §6.1). Only invoicing code may use this service.
 *
 * The scope comes from the platform (session resolution happens there); this
 * service pushes it into invoicing's own transaction, where row-level
 * security checks it against invoicing's read-only copy of the brands.
 *
 * The runtime connection uses a NON-owner role (invoicing_app), which also
 * holds no write grant on the brand copy.
 */
@Injectable()
export class InvoicingPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoicingPrismaService.name);

  /** Owner-role connection, used only by withoutScope — see the platform's
   * PlatformPrismaService for why the owner is the one true escape hatch. */
  private readonly unscopedClient: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    super({
      datasources: { db: { url: env.INVOICING_DATABASE_URL } },
      log:
        env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['warn', 'error'],
    });

    if (!env.INVOICING_DIRECT_DATABASE_URL) {
      this.logger.warn(
        'INVOICING_DIRECT_DATABASE_URL is not set — withoutScope will run on the RLS-bound ' +
          'connection and silently return nothing for any protected table. Set it for the ' +
          'public payment path and any cross-tenant job to work at all.',
      );
    }
    this.unscopedClient = new PrismaClient({
      datasources: {
        db: { url: env.INVOICING_DIRECT_DATABASE_URL ?? env.INVOICING_DATABASE_URL },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.unscopedClient.$connect();
    this.logger.log('invoicing database connection established');
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
   * Escape hatch for work that is genuinely cross-tenant: the public payment
   * path, reconciliation jobs, event handlers. Named to be conspicuous in
   * review, and every call site is expected to justify itself.
   */
  async withoutScope<T>(reason: string, work: (client: PrismaClient) => Promise<T>): Promise<T> {
    this.logger.warn(`unscoped database access: ${reason}`);
    return work(this.unscopedClient);
  }

  /** The owner connection for event handlers, which run on every delivery
   * and would otherwise flood the log through withoutScope's warning. */
  get ownerClient(): PrismaClient {
    return this.unscopedClient;
  }

  /** True when the error is a unique-constraint violation on `target`. */
  static isUniqueViolation(error: unknown, target?: string): boolean {
    return isUniqueViolation(error, target);
  }
}
