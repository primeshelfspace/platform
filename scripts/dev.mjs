#!/usr/bin/env node
/**
 * Starts the local dev stack: the three apps plus the shared package's watch.
 *
 * Two failure modes this exists to prevent, both of which surface as errors
 * that point nowhere near their cause:
 *
 *  1. `packages/shared` is consumed as build output — the apps import its
 *     compiled dist/, not its source (see its package.json "exports"). A
 *     plain `--filter "./apps/*" dev` never starts its tsc watch, so an edit
 *     to shared leaves every app checking against a stale .d.ts. The symptom
 *     is a TS2339 for a property that is plainly right there in the source.
 *     So shared is built once up front, then watched alongside the apps.
 *
 *  2. Nest's `start --watch` supervisor outlives the terminal that started
 *     it. Left running, it recompiles on the next edit and respawns a child
 *     that races the current session for API_PORT — EADDRINUSE attributed to
 *     a process nobody remembers starting, from a session closed yesterday.
 *     So this reclaims stale supervisors and port holders before starting.
 *
 * Reclaiming only ever targets processes whose working directory is inside
 * this repository. A port held by anything else is reported and fatal, never
 * killed: other checkouts and unrelated local services are not ours to stop.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { ROOT, loadRootEnv } from './lib/env.mjs';
import { c, fail, log, ok, portOpen, run, step, warn } from './lib/proc.mjs';

loadRootEnv();

/** The ports we are about to bind, with the same defaults the apps use. */
const PORTS = [
  { name: 'api', port: Number(process.env.API_PORT ?? 4000) },
  { name: 'admin', port: Number(process.env.ADMIN_PORT ?? 3000) },
  { name: 'payment', port: Number(process.env.PAYMENT_PORT ?? 3001) },
];

const POSIX = process.platform !== 'win32';

/** PIDs listening on a port. Empty when lsof is unavailable. */
function listenersOn(port) {
  const r = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  return r.stdout
    ? r.stdout
        .split('\n')
        .map((l) => Number(l.trim()))
        .filter(Boolean)
    : [];
}

/** A process's cwd, or null when it cannot be determined. */
function cwdOf(pid) {
  const r = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const line = r.stdout.split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : null;
}

/** Whether a pid belongs to this repository. Unknown cwd counts as foreign. */
function isOurs(pid) {
  const cwd = cwdOf(pid);
  return cwd !== null && (cwd === ROOT || cwd.startsWith(`${ROOT}/`));
}

function describe(pid) {
  const r = run('ps', ['-o', 'lstart=,command=', '-p', String(pid)]);
  return r.stdout.replace(/\s+/g, ' ').trim() || `pid ${pid}`;
}

/**
 * Nest watch supervisors from this repo that run the main entry.
 *
 * Enumerated with `ps` rather than `pgrep -af`: macOS pgrep does not support
 * -a and prints bare pids for it, with exit status 0 and no warning. The
 * command line this filters on then arrives empty, which fails in both
 * directions at once — the worker exemption below never matches, and a pid
 * parsed out of a line with no space in it comes back truncated (21854 ->
 * 2185), aiming SIGTERM at whatever unrelated process holds that number.
 *
 * The worker supervisor (`--entryFile worker`) is deliberately spared: it is
 * started separately via `dev:worker`, binds none of the ports above, and
 * stopping it would silently halt queue processing that the developer chose
 * to run.
 */
function staleMainWatchers() {
  const r = run('ps', ['-Ao', 'pid=,command=']);
  if (!r.stdout) return [];
  return r.stdout
    .split('\n')
    .map((line) => {
      const m = /^\s*(\d+)\s+(\S.*)$/.exec(line);
      return m ? { pid: Number(m[1]), cmd: m[2] } : null;
    })
    .filter((p) => p !== null && p.pid !== process.pid && p.pid !== process.ppid)
    .filter(({ cmd }) => /\bnest(\.js)? start\b.*--watch\b/.test(cmd))
    .filter(({ cmd }) => !cmd.includes('--entryFile worker'))
    .filter(({ pid }) => isOurs(pid));
}

/** SIGTERM, then SIGKILL whatever is still standing. */
async function stop(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  for (let i = 0; i < 20; i++) {
    if (!pids.some(alive)) return;
    await sleep(150);
  }
  for (const pid of pids.filter(alive)) {
    warn(`  ${pid} ignored SIGTERM — sending SIGKILL`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* raced us */
    }
  }
  for (let i = 0; i < 20 && pids.some(alive); i++) await sleep(150);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reclaim() {
  if (!POSIX) {
    warn('port reclaim skipped: needs lsof/pgrep (POSIX only)');
    return;
  }

  // Survey every port before stopping anything. A fatal conflict on the third
  // port must not leave the first two torn down: this used to kill admin and
  // payment, then abort on the api port, which is worse than doing nothing.
  const held = [];
  const foreign = [];
  for (const { name, port } of PORTS) {
    for (const pid of listenersOn(port)) {
      (isOurs(pid) ? held : foreign).push({ name, port, pid, cwd: cwdOf(pid) });
    }
  }

  if (foreign.length) {
    for (const { name, port, pid, cwd } of foreign) {
      fail(`${name} port ${port} is held by a process outside this repository:`);
      log(`    pid ${pid}  cwd ${cwd ?? 'unknown'}`);
      log(`    ${c.dim}${describe(pid)}${c.reset}`);
    }
    log();
    log('Nothing was stopped. Either stop that process yourself, or pick another');
    log(`port in .env (${PORTS.map((p) => `${p.name.toUpperCase()}_PORT`).join(', ')}).`);
    process.exit(1);
  }

  const watchers = staleMainWatchers();
  if (watchers.length) {
    step(`stopping ${watchers.length} stale nest watcher(s) from an earlier session`);
    for (const { pid } of watchers) log(`  ${c.dim}${pid} ${describe(pid)}${c.reset}`);
    // Supervisors first: kill a child while its parent is still watching and
    // the parent simply respawns it straight back onto the port.
    await stop(watchers.map((w) => w.pid));
  }

  for (const { name, port } of PORTS) {
    const ours = held
      .filter((h) => h.port === port)
      .map((h) => h.pid)
      .filter(alive);
    if (!ours.length) continue;
    step(`freeing ${name} port ${port} (held by ${ours.join(', ')} from this repo)`);
    await stop(ours);
    for (let i = 0; i < 20 && (await portOpen(port)); i++) await sleep(150);
  }
}

function pnpm(args, { inherit = true } = {}) {
  return spawn('pnpm', args, {
    cwd: ROOT,
    stdio: inherit ? 'inherit' : 'pipe',
    // The filter patterns below are pnpm's own globs, not the shell's, so they
    // are passed through literally — no shell, nothing to re-expand them.
    shell: false,
  });
}

function runToCompletion(args) {
  return new Promise((resolve) => {
    const child = pnpm(args);
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

await reclaim();

// Once, before anything imports it, so the apps never start against a stale
// dist. The watch below keeps it fresh from here on.
step('building @fenwick/shared');
const built = await runToCompletion(['--filter', '@fenwick/shared', 'build']);
if (built !== 0) {
  fail('@fenwick/shared failed to build — fix that before the apps start');
  process.exit(built);
}
ok('@fenwick/shared built');

step('starting apps + shared watch');
log();
const dev = pnpm(['--parallel', '--filter', './apps/*', '--filter', '@fenwick/shared', 'dev']);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // The child shares our process group, so an interactive Ctrl-C already
    // reached it; this covers a signal sent to us alone.
    try {
      dev.kill(signal);
    } catch {
      /* already exiting */
    }
  });
}

dev.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
