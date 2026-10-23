/**
 * Creates the per-module databases and their roles. Idempotent: safe to run
 * on every setup. Needs a superuser connection (DATABASE_ADMIN_URL) because
 * creating roles and databases is not something a module's own roles can do.
 *
 *   pnpm --filter @platform/api db:bootstrap
 *
 * For each module it reads <MODULE>_DATABASE_URL (runtime, non-owner role)
 * and <MODULE>_DIRECT_DATABASE_URL (owner role) and ensures:
 *   - both roles exist with the passwords in those URLs
 *   - the database exists, owned by the owner role
 *   - nobody but those two roles may connect to it (no PUBLIC connect)
 *
 * Grants on tables and row-level security are NOT set here — they live in
 * each module's own migrations, next to the tables they protect.
 */
import { PrismaClient } from '../../apps/platform/generated/index.js';

const MODULES = ['PLATFORM', 'INVOICING'] as const;

interface Target {
  readonly module: string;
  readonly database: string;
  readonly owner: { readonly role: string; readonly password: string };
  readonly app: { readonly role: string; readonly password: string };
}

function parse(module: string): Target {
  const appUrl = process.env[`${module}_DATABASE_URL`];
  const ownerUrl = process.env[`${module}_DIRECT_DATABASE_URL`];
  if (!appUrl || !ownerUrl) {
    throw new Error(`${module}_DATABASE_URL and ${module}_DIRECT_DATABASE_URL must both be set`);
  }
  const app = new URL(appUrl);
  const owner = new URL(ownerUrl);
  const database = app.pathname.replace(/^\//, '');
  if (owner.pathname.replace(/^\//, '') !== database) {
    throw new Error(`${module}: the runtime and owner URLs point at different databases`);
  }
  return {
    module,
    database,
    owner: {
      role: decodeURIComponent(owner.username),
      password: decodeURIComponent(owner.password),
    },
    app: { role: decodeURIComponent(app.username), password: decodeURIComponent(app.password) },
  };
}

/** Identifiers and literals here come from our own .env, but quote them
 * properly anyway — this runs as a superuser. */
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function main(): Promise<void> {
  const adminUrl = process.env['DATABASE_ADMIN_URL'];
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required to bootstrap the databases');

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    for (const target of MODULES.map(parse)) {
      for (const { role, password } of [target.owner, target.app]) {
        const exists = await admin.$queryRawUnsafe<unknown[]>(
          `SELECT 1 FROM pg_roles WHERE rolname = ${literal(role)}`,
        );
        const verb = exists.length ? 'ALTER' : 'CREATE';
        // No NOSUPERUSER: it is the default, and on RDS the master login is
        // not a superuser, so any mention of the SUPERUSER attribute is refused.
        await admin.$executeRawUnsafe(
          `${verb} ROLE ${ident(role)} LOGIN PASSWORD ${literal(password)} NOCREATEROLE`,
        );
      }
      // Prisma's migrate needs to create a temporary shadow database only for
      // `migrate dev`; deploy does not. The owner gets CREATEDB anyway so a
      // developer can run `migrate dev` against their own module.
      await admin.$executeRawUnsafe(`ALTER ROLE ${ident(target.owner.role)} CREATEDB`);

      const db = await admin.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM pg_database WHERE datname = ${literal(target.database)}`,
      );
      if (!db.length) {
        // A non-superuser admin (the RDS master) must be a member of a role
        // to make it a database's owner.
        await admin.$executeRawUnsafe(`GRANT ${ident(target.owner.role)} TO CURRENT_USER`);
        await admin.$executeRawUnsafe(
          `CREATE DATABASE ${ident(target.database)} OWNER ${ident(target.owner.role)}`,
        );
      }
      await admin.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${ident(target.database)} FROM PUBLIC`);
      await admin.$executeRawUnsafe(
        `GRANT CONNECT, TEMPORARY ON DATABASE ${ident(target.database)} TO ${ident(target.owner.role)}, ${ident(target.app.role)}`,
      );
      console.log(
        `✓ ${target.module.toLowerCase()}: database "${target.database}", owner "${target.owner.role}", app "${target.app.role}"`,
      );
    }
  } finally {
    await admin.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
