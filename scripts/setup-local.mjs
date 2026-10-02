#!/usr/bin/env node
/**
 * One command to a working stack (NFR-MNT-008).
 *
 *   pnpm install && pnpm setup:local && pnpm dev
 *
 * Steps: env file → services → migrations → seed → browser binaries → verify.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, log, step, ok, warn, run, runOrExit, portOpen } from './lib/proc.mjs';

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

// 3. Shared package build (api and both web apps import its types) ----------
log();
step('building @sugrpay/shared');
runOrExit('pnpm', ['--filter', '@sugrpay/shared', 'build'], { cwd: ROOT });
ok('shared package built');

// 4. Database ---------------------------------------------------------------
log();
step('applying migrations');
runOrExit('pnpm', ['--filter', '@sugrpay/api', 'db:migrate'], { cwd: ROOT });
ok('schema up to date');

step('seeding multi-brand dataset');
runOrExit('pnpm', ['--filter', '@sugrpay/api', 'db:seed'], { cwd: ROOT });
ok('seed data loaded');

// 5. Browser binaries -------------------------------------------------------
log();
step('playwright browsers (PDF rendering + e2e)');
const pw = run('pnpm', ['exec', 'playwright', 'install', 'chromium'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (pw.code === 0) ok('chromium installed');
else
  warn('playwright install failed — PDF generation and e2e tests will not run until it succeeds');

// 6. Verify -----------------------------------------------------------------
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
  log(`  ${c.dim}admin  ${c.reset}http://localhost:3000`);
  log(`  ${c.dim}payment${c.reset} http://localhost:3001`);
  log(`  ${c.dim}api    ${c.reset}http://localhost:4000/health`);
  log(`  ${c.dim}mail   ${c.reset}http://localhost:1080`);
} else {
  warn(`setup finished in ${secs}s with unhealthy services — see above`);
  process.exit(1);
}
