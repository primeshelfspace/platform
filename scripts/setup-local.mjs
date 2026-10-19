#!/usr/bin/env node
/**
 * One command to a working stack (NFR-MNT-008).
 *
 *   pnpm install && pnpm setup:local && pnpm dev
 *
 * Steps: env file → services → databases → migrations → seed → verify.
 */
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
  fs.copyFileSync(path.join(ROOT, '.env.example'), envPath);
  ok('.env created from .env.example');
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
log();
step('creating module databases and roles (DATABASE_ADMIN_URL)');
const bootstrap = run('pnpm', ['--filter', '@platform/api', 'db:bootstrap'], {
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
runOrExit('pnpm', ['--filter', '@platform/api', 'db:migrate'], { cwd: ROOT });
ok('schemas up to date');

step('seeding multi-brand dataset');
runOrExit('pnpm', ['--filter', '@platform/api', 'db:seed'], { cwd: ROOT });
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
  log(`  ${c.dim}api    ${c.reset}http://localhost:4000/health`);
  log(`  ${c.dim}mail   ${c.reset}http://localhost:1080`);
  log(`  ${c.dim}web apps live in the sugrpay-frontend repository${c.reset}`);
} else {
  warn(`setup finished in ${secs}s with unhealthy services — see above`);
  process.exit(1);
}
