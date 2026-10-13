#!/usr/bin/env node
/**
 * Refuses to let a destructive database command (prisma migrate reset, which
 * drops every table and reseeds from scratch) run against a shared/remote
 * database by accident.
 *
 * This exists because that exact command wiped the shared RDS instance's real
 * data once already (every row's createdAt landed within the same few minutes
 * — a brand, its Zoho connection, and every test account this platform had
 * were gone). A team .env may point the module databases at a shared AWS RDS
 * instance rather than a local Postgres, which means the usual "it's just my
 * local database" assumption behind `db:reset` does not hold — running it
 * wipes the one shared copy everyone (and the live/staging server) uses.
 *
 * Checks every module database (platform and invoicing, runtime and owner
 * URLs), because `pnpm db:reset` resets all of them.
 *
 *   node scripts/guard-destructive-db.mjs && pnpm db:reset
 */
import { loadRootEnv } from './lib/env.mjs';

loadRootEnv();

// Every module database a reset touches. A missing value counts as non-local,
// so a half-configured .env is refused rather than guessed at.
const URL_KEYS = [
  'PLATFORM_DATABASE_URL',
  'PLATFORM_DIRECT_DATABASE_URL',
  'INVOICING_DATABASE_URL',
  'INVOICING_DIRECT_DATABASE_URL',
];

// Anything that isn't obviously a loopback/local address is treated as
// shared. This deliberately errs toward refusing: a false positive costs one
// override flag, a false negative costs the whole database again.
const LOCAL_HOST_PATTERN = /^(postgres(?:ql)?:\/\/)[^@]*@(localhost|127\.0\.0\.1|::1)[:/]/i;
const isLocal = (u) => LOCAL_HOST_PATTERN.test(u ?? '');

const override = process.env.ALLOW_DESTRUCTIVE_DB_RESET === 'yes-really';
const remote = URL_KEYS.filter((key) => !isLocal(process.env[key]));

if (remote.length) {
  if (override) {
    console.warn(
      '\n[guard-destructive-db] ALLOW_DESTRUCTIVE_DB_RESET=yes-really is set — proceeding ' +
        'against a non-local database anyway.\n',
    );
  } else {
    console.error(
      '\n[guard-destructive-db] Refusing to run a destructive database reset.\n\n' +
        `${remote.join(', ')} does not point at localhost — it looks like a shared/remote ` +
        'database. `prisma migrate reset` drops every table and reseeds from scratch; it ' +
        'already destroyed a shared database once.\n\n' +
        'If this is genuinely a disposable database and you mean to wipe it, re-run with:\n' +
        '  ALLOW_DESTRUCTIVE_DB_RESET=yes-really pnpm db:reset\n',
    );
    process.exit(1);
  }
}
