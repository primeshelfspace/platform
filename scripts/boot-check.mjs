#!/usr/bin/env node
/**
 * Boots the built API with a given set of products and checks it comes up
 * healthy — the runtime half of the module rules: the platform must start
 * with no product at all, and each product must start with only the
 * platform beside it.
 *
 *   node scripts/boot-check.mjs ""            # platform alone
 *   node scripts/boot-check.mjs invoicing     # platform + invoicing
 *
 * Needs a build (pnpm --filter @platform/api build) and the services running.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, loadRootEnv } from './lib/env.mjs';
import { fail, log, ok } from './lib/proc.mjs';

loadRootEnv();

const products = process.argv[2] ?? '';
const port = Number(process.env.BOOT_CHECK_PORT ?? 4099);
const label = products ? `platform + ${products}` : 'platform alone';
const timeoutMs = 60_000;

const child = spawn(process.execPath, [path.join(ROOT, 'apps', 'api', 'dist', 'main.js')], {
  cwd: path.join(ROOT, 'apps', 'api'),
  env: {
    ...process.env,
    ENABLED_PRODUCTS: products,
    API_PORT: String(port),
    // No scheduled jobs or outbox polling from a throwaway process.
    ENABLE_SCHEDULER: 'false',
    OUTBOX_POLL_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));

const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));

async function healthy() {
  try {
    const response = await fetch(`http://localhost:${port}/health/ready`);
    return response.status === 200;
  } catch {
    return false;
  }
}

const deadline = Date.now() + timeoutMs;
let up = false;
while (Date.now() < deadline) {
  const done = await Promise.race([
    exited,
    new Promise((r) => setTimeout(() => r(undefined), 500)),
  ]);
  if (done !== undefined) break;
  if (await healthy()) {
    up = true;
    break;
  }
}
// Prove the product set is what was asked for: an invoicing route must not
// exist at all without invoicing (404), and must exist — guarded, so 401
// without a session — with it.
let productsMatch = false;
if (up) {
  const status = await fetch(`http://localhost:${port}/dashboard/summary`)
    .then((r) => r.status)
    .catch(() => 0);
  const expected = products.split(',').includes('invoicing') ? 401 : 404;
  productsMatch = status === expected;
  if (!productsMatch)
    fail(`${label}: GET /dashboard/summary returned ${status}, expected ${expected}`);
}
child.kill();

if (up && productsMatch) {
  ok(`${label}: booted and ready`);
  process.exit(0);
}
fail(`${label}: did not become ready`);
log(output.split('\n').slice(-40).join('\n'));
process.exit(1);
