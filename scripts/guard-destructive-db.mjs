#!/usr/bin/env node
/**
 * Refuses to let a destructive database command (prisma migrate reset, which
 * drops every table and reseeds from scratch) run against a shared/remote
 * database by accident.
 *
 * This exists because that exact command wiped the shared RDS instance's real
 * data once already (every row's createdAt landed within the same few minutes
 * — a brand, its Zoho connection, and every test account this platform had
 * were gone). DATABASE_URL in this repo's .env is intentionally pointed at a
 * shared AWS RDS instance rather than a local Postgres (see .env's own
 * comment), which means the usual "it's just my local database" assumption
 * behind `db:reset` does not hold here — running it wipes the one shared
 * copy everyone (and the live/staging server) actually uses.
 *
 *   node scripts/guard-destructive-db.mjs && node scripts/with-env.mjs prisma migrate reset --force
 */
import { loadRootEnv } from './lib/env.mjs';

loadRootEnv();

const url = process.env.DATABASE_URL ?? '';
const directUrl = process.env.DIRECT_DATABASE_URL ?? '';

// Anything that isn't obviously a loopback/local address is treated as
// shared. This deliberately errs toward refusing: a false positive costs one
// override flag, a false negative costs the whole database again.
const LOCAL_HOST_PATTERN = /^(postgres(?:ql)?:\/\/)[^@]*@(localhost|127\.0\.0\.1|::1)[:/]/i;
const isLocal = (u) => LOCAL_HOST_PATTERN.test(u);

const override = process.env.ALLOW_DESTRUCTIVE_DB_RESET === 'yes-really';

if (!isLocal(url) || !isLocal(directUrl)) {
  if (override) {
    console.warn(
      '\n[guard-destructive-db] ALLOW_DESTRUCTIVE_DB_RESET=yes-really is set — proceeding ' +
        'against a non-local database anyway.\n',
    );
  } else {
    console.error(
      '\n[guard-destructive-db] Refusing to run a destructive database reset.\n\n' +
        'DATABASE_URL (or DIRECT_DATABASE_URL) does not point at localhost — it looks like a ' +
        'shared/remote database. `prisma migrate reset` drops every table and reseeds from ' +
        'scratch; it already destroyed this exact shared database once.\n\n' +
        'If this is genuinely a disposable database and you mean to wipe it, re-run with:\n' +
        '  ALLOW_DESTRUCTIVE_DB_RESET=yes-really pnpm db:reset\n',
    );
    process.exit(1);
  }
}
