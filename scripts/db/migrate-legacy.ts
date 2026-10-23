/**
 * One-off: copies a pre-split, single-database Sugrpay installation into the
 * per-module databases (platform, invoicing).
 *
 *   LEGACY_DATABASE_URL=postgresql://owner@host/sugrpay \
 *     pnpm --filter @platform/api db:migrate-legacy
 *
 * Preconditions: both module databases exist and are migrated (db:bootstrap,
 * db:migrate) and are EMPTY — this refuses to merge into existing data. The
 * legacy database is only read, never written.
 *
 * Every row keeps its id, so sessions, public payment links, Zoho ids and
 * audit history carry over unchanged. Each table is copied whole, in
 * foreign-key order, inside one transaction per target database; the
 * invoicing database also gets its read-only copy of every brand. Row counts
 * are compared at the end, and any mismatch fails the run.
 *
 * Connects as each database's OWNER (*_DIRECT_DATABASE_URL): row-level
 * security would otherwise hide every tenant's rows.
 */
import { PrismaClient as InvoicingClient } from '../../apps/sugrpay/generated/index.js';
import { PrismaClient as PlatformClient } from '../../apps/platform/generated/index.js';

const PLATFORM_TABLES = [
  'merchant',
  'user',
  'brand',
  'user_brand_assignment',
  'session',
  'password_reset_token',
  'integration_connection',
  'audit_log',
] as const;

/** `brand` here is invoicing's copy — see copyBrandReplica. */
const INVOICING_TABLES = [
  'brand_settings',
  'tax_rate',
  'customer',
  'customer_contact_person',
  'invoice',
  'line_item',
  'payment',
  'invoice_event',
  'check_submission',
  'sync_job',
  'pending_brand_assignment',
] as const;

const BATCH = 500;

type RawClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** JSON-safe row: bigint money columns travel as strings and are cast back
 * by json_populate_recordset on the way in. */
function jsonSafe(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'bigint' ? value.toString() : value,
    ]),
  );
}

async function tableExists(client: RawClient, table: string): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT to_regclass('public."${table}"') IS NOT NULL AS exists`,
  );
  return rows[0]?.exists === true;
}

async function count(client: RawClient, table: string): Promise<number> {
  const rows = await client.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM "${table}"`,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Copies every row of `table` from the legacy database into `target`.
 * json_populate_recordset maps by column NAME onto the target table's own
 * row type, so column order never matters and enum/array/json/bigint values
 * are cast by PostgreSQL itself. `extra` adds columns the legacy table never
 * had.
 */
async function copyTable(
  legacy: RawClient,
  target: RawClient,
  table: string,
  extra: Record<string, unknown> = {},
): Promise<number> {
  let copied = 0;
  for (let offset = 0; ; offset += BATCH) {
    const rows = await legacy.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${table}" ORDER BY ctid LIMIT ${BATCH} OFFSET ${offset}`,
    );
    if (!rows.length) break;
    const payload = JSON.stringify(rows.map((row) => ({ ...jsonSafe(row), ...extra })));
    await target.$executeRawUnsafe(
      `INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json)`,
      payload,
    );
    copied += rows.length;
    if (rows.length < BATCH) break;
  }
  return copied;
}

async function main(): Promise<void> {
  const legacyUrl = required('LEGACY_DATABASE_URL');
  const legacy = new PlatformClient({ datasources: { db: { url: legacyUrl } } });
  const platform = new PlatformClient({
    datasources: { db: { url: required('PLATFORM_DIRECT_DATABASE_URL') } },
  });
  const invoicing = new InvoicingClient({
    datasources: { db: { url: required('INVOICING_DIRECT_DATABASE_URL') } },
  });

  try {
    for (const table of ['merchant', 'brand', 'invoice']) {
      if (!(await tableExists(legacy, table))) {
        throw new Error(
          `LEGACY_DATABASE_URL has no "${table}" table — is it the pre-split database?`,
        );
      }
    }
    const occupied = (await count(platform, 'merchant')) + (await count(invoicing, 'brand'));
    if (occupied > 0) {
      throw new Error(
        'the module databases already contain data — this only migrates into empty ones ' +
          '(on a disposable environment: pnpm db:reset, then truncate, then re-run)',
      );
    }

    const results: Array<{ database: string; table: string; legacy: number; copied: number }> = [];

    await platform.$transaction(
      async (tx) => {
        for (const table of PLATFORM_TABLES) {
          if (!(await tableExists(legacy, table))) continue;
          const copied = await copyTable(legacy, tx, table);
          results.push({ database: 'platform', table, legacy: await count(legacy, table), copied });
        }
        // The legacy system was invoicing only: every company keeps invoicing,
        // and every user's role becomes their invoicing role.
        await tx.$executeRawUnsafe(
          `INSERT INTO subscription (id, merchant_id, product, status, updated_at)
           SELECT gen_random_uuid(), m.id, 'INVOICING', 'ACTIVE', now() FROM merchant m
           ON CONFLICT (merchant_id, product) DO NOTHING`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO user_product_role (user_id, product, role, updated_at)
           SELECT u.id, 'INVOICING', u.role::text, now() FROM "user" u
           ON CONFLICT (user_id, product) DO NOTHING`,
        );
      },
      { timeout: 30 * 60_000, maxWait: 60_000 },
    );

    await invoicing.$transaction(
      async (tx) => {
        // The read-only brand copy first: everything else references it.
        const copiedBrands = await copyTable(legacy, tx, 'brand', {
          replicated_at: new Date().toISOString(),
        });
        results.push({
          database: 'invoicing',
          table: 'brand (copy)',
          legacy: await count(legacy, 'brand'),
          copied: copiedBrands,
        });
        for (const table of INVOICING_TABLES) {
          if (!(await tableExists(legacy, table))) continue;
          const copied = await copyTable(legacy, tx, table);
          results.push({
            database: 'invoicing',
            table,
            legacy: await count(legacy, table),
            copied,
          });
        }
        // Every brand has invoicing settings now (the brand event creates
        // them); a legacy brand that never had a row gets the defaults.
        const filled = await tx.$executeRawUnsafe(
          `INSERT INTO brand_settings (brand_id, updated_at)
           SELECT b.id, now() FROM brand b
           WHERE NOT EXISTS (SELECT 1 FROM brand_settings s WHERE s.brand_id = b.id)`,
        );
        if (filled > 0) {
          console.log(
            `  + created default invoicing settings for ${filled} brand(s) that had none`,
          );
        }
      },
      { timeout: 30 * 60_000, maxWait: 60_000 },
    );

    console.log('');
    for (const r of results) {
      const mark = r.legacy === r.copied ? '✓' : '✗';
      console.log(
        `  ${mark} ${r.database.padEnd(10)} ${r.table.padEnd(26)} ${r.copied}/${r.legacy}`,
      );
    }
    const mismatched = results.filter((r) => r.legacy !== r.copied);
    if (mismatched.length) {
      throw new Error(`${mismatched.length} table(s) did not copy completely`);
    }
    console.log('\n  legacy data copied into the platform and invoicing databases.\n');
  } finally {
    await Promise.all([legacy.$disconnect(), platform.$disconnect(), invoicing.$disconnect()]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
