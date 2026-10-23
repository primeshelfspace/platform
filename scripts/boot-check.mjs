#!/usr/bin/env node
/**
 * Starts one built API on its own and checks it comes up healthy — the runtime
 * half of the API boundaries: each API must start with no other API running.
 *
 *   node scripts/boot-check.mjs platform
 *   node scripts/boot-check.mjs sugrpay
 *
 * Needs a build (pnpm build) and the databases and Redis running. (Sugrpay
 * answering a signed-in route needs the platform; booting does not.)
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, loadRootEnv } from './lib/env.mjs';
import { fail, log, ok } from './lib/proc.mjs';

loadRootEnv();

const app = process.argv[2] ?? '';
if (!['platform', 'sugrpay', 'hq'].includes(app)) {
  fail('usage: node scripts/boot-check.mjs platform|sugrpay|hq');
  process.exit(1);
}
const port = Number(process.env.BOOT_CHECK_PORT ?? 4099);
const label = `${app} API alone`;
const timeoutMs = 60_000;

const child = spawn(process.execPath, [path.join(ROOT, 'apps', app, 'dist', 'main.js')], {
  cwd: path.join(ROOT, 'apps', app),
  env: {
    ...process.env,
    PLATFORM_API_PORT: String(port),
    SUGRPAY_API_PORT: String(port),
    HQ_API_PORT: String(port),
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
// Prove it is the API that was asked for: a Sugrpay route exists (guarded,
// so 401 without a session) only on the Sugrpay API, and 404 elsewhere.
let productsMatch = false;
if (up) {
  const status = await fetch(`http://localhost:${port}/dashboard/summary`)
    .then((r) => r.status)
    .catch(() => 0);
  const expected = app === 'sugrpay' ? 401 : 404;
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
