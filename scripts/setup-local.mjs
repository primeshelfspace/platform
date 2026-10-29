#!/usr/bin/env node
/**
 * One command to a working stack (NFR-MNT-008).
 *
 *   pnpm install && pnpm setup:local && pnpm dev
 *
 * Steps: env file → services → databases → migrations → seed → verify.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, fail, log, step, ok, warn, run, runOrExit, portOpen } from './lib/proc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();

log(`${c.bold}Sugrpay — local environment setup${c.reset}\n`);

// 1. Environment file -------------------------------------------------------
step('environment file');
const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
  // .env.example carries a placeholder, never a usable key (env.ts refuses
  // the one that used to be committed there) — each checkout gets its own.
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  fs.writeFileSync(
    envPath,
    example
      .replace(
        /^CREDENTIAL_ENCRYPTION_KEY=.*$/m,
        `CREDENTIAL_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
      )
      .replace(/^PRODUCT_JWT_SECRET=.*$/m, `PRODUCT_JWT_SECRET=${randomBytes(32).toString('hex')}`),
  );
  ok(
    '.env created from .env.example, with a fresh CREDENTIAL_ENCRYPTION_KEY and PRODUCT_JWT_SECRET',
  );
} else {
  ok('.env already present, left untouched');
}

// 2. Dependency services ----------------------------------------------------
log();
runOrExit(process.execPath, [path.join(ROOT, 'scripts', 'services.mjs'), 'up'], { cwd: ROOT });

// 3. Shared package build (the api imports its types) ----------------------
log();
step('building the shared packages (kernel, contracts)');
runOrExit('pnpm', ['--filter', './packages/*', 'build'], { cwd: ROOT });
ok('shared packages built');

// 4. Databases (one per module) --------------------------------------------
// db:bootstrap and db:seed are root-level scripts (scripts/db/*.ts, shared
// across every app); db:migrate is a root composite that filters to each
// app with its own schema (platform-api, sugrpay-api — hq has none).
//
// bootstrap.ts imports each app's generated Prisma client purely for
// PrismaClient's raw-query methods (no models of its own are touched) — but
// on a fresh checkout nothing has generated it yet, since generation is
// otherwise only a side effect of db:migrate, which cannot run until the
// databases bootstrap creates exist. `prisma generate` itself needs no live
// database (it only reads the schema file), so it can safely run first.
log();
step('generating Prisma clients');
runOrExit('pnpm', ['db:generate'], { cwd: ROOT });
ok('Prisma clients generated');

step('creating module databases and roles (DATABASE_ADMIN_URL)');
const bootstrap = run('pnpm', ['db:bootstrap'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (bootstrap.code !== 0) {
  fail(
    'could not create the databases — DATABASE_ADMIN_URL in .env must be a PostgreSQL ' +
      'superuser (docker-compose: sugrpay/sugrpay; a native install: usually postgres/<your password>)',
  );
  process.exit(1);
}
ok('platform and invoicing databases ready');

step('applying migrations (platform, invoicing)');
runOrExit('pnpm', ['db:migrate'], { cwd: ROOT });
ok('schemas up to date');

step('seeding multi-brand dataset');
runOrExit('pnpm', ['db:seed'], { cwd: ROOT });
ok('seed data loaded');

// 5. Verify -----------------------------------------------------------------
// (PDF rendering's Chromium comes with puppeteer at install time.)
log();
step('verifying');
const checks = [
  ['postgres', 5432],
  ['redis', 6379],
  ['mail sink', 1025],
];
let healthy = true;
for (const [label, port] of checks) {
  const isUp = await portOpen(port);
  healthy &&= isUp;
  log(`  ${isUp ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`} ${label}`);
}

const secs = Math.round((Date.now() - started) / 1000);
log();
if (healthy) {
  log(
    `${c.green}${c.bold}Ready in ${secs}s.${c.reset} Start the stack with ${c.bold}pnpm dev${c.reset}:`,
  );
  log(`  ${c.dim}platform${c.reset}http://localhost:4001/health`);
  log(`  ${c.dim}sugrpay ${c.reset}http://localhost:4002/health`);
  log(`  ${c.dim}hq      ${c.reset}http://localhost:4003/health`);
  log(`  ${c.dim}mail    ${c.reset}http://localhost:1080`);
  log(`  ${c.dim}web apps live in the sugrpay-frontend repository${c.reset}`);
} else {
  warn(`setup finished in ${secs}s with unhealthy services — see above`);
  process.exit(1);
}
