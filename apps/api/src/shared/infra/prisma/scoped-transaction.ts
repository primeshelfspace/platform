import { type Scope, databaseScopeSettings } from '@sugrpay/shared';

/**
 * The tenant-isolation mechanics shared by every module's own Prisma service.
 * Each module owns its database and its generated client; what they share is
 * how a request scope is pushed into a transaction so row-level security can
 * read it (TDD-001 §6.1).
 */

/** Interactive-transaction options used for every scoped unit of work.
 *
 * Prisma's own defaults are maxWait: 2s (time allowed just to acquire a
 * pooled connection and start) and timeout: 5s (time allowed for the
 * transaction body to run) — both separate from connect_timeout/pool_timeout
 * on the URL. A remote database's per-query latency can exceed either
 * default; 30s matches the headroom given to connection setup elsewhere. */
export const SCOPED_TRANSACTION_OPTIONS = { maxWait: 30_000, timeout: 30_000 } as const;

/** The minimum a transaction client must offer to receive a scope. */
interface RawExecutor {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * Pushes `scope` into the current transaction's PostgreSQL settings.
 * set_config with is_local = true scopes the setting to this transaction, so a
 * pooled connection cannot leak one request's scope into the next.
 */
export async function applyScope(tx: RawExecutor, scope: Scope): Promise<void> {
  for (const [key, value] of Object.entries(databaseScopeSettings(scope))) {
    await tx.$executeRaw`SELECT set_config(${key}, ${value}, true)`;
  }
}

/**
 * True when the error is a unique-constraint violation on `target`.
 *
 * Duck-typed rather than `instanceof`: each module has its own generated
 * client, and each generated client has its own error classes.
 */
export function isUniqueViolation(error: unknown, target?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: Record<string, unknown> };
  if (code !== 'P2002') return false;
  if (!target) return true;
  const fields = meta?.['target'];
  return Array.isArray(fields) ? fields.includes(target) : fields === target;
}
