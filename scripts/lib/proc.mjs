import { spawnSync } from 'node:child_process';
import net from 'node:net';

export const c = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  bold: '\u001b[1m',
};

export function log(msg = '') {
  process.stdout.write(`${msg}\n`);
}

export function step(msg) {
  log(`${c.cyan}▸${c.reset} ${msg}`);
}

export function ok(msg) {
  log(`${c.green}✓${c.reset} ${msg}`);
}

export function warn(msg) {
  log(`${c.yellow}!${c.reset} ${msg}`);
}

export function fail(msg) {
  log(`${c.red}✗${c.reset} ${msg}`);
}

/**
 * On Windows, pnpm/npx and friends are .cmd shims that spawnSync can only
 * launch through the shell (without it they fail with ENOENT). Every caller
 * here passes plain words as arguments, so the shell has nothing to
 * misinterpret.
 */
const SHELL = process.platform === 'win32';

/** Through the shell, a path with a space (C:\Program Files\nodejs\node.exe)
 * would split into two words — quote anything containing whitespace. */
const forShell = (word) => (SHELL && /\s/.test(word) ? `"${word}"` : word);

function spawnArgs(cmd, args) {
  return [forShell(cmd), args.map(forShell)];
}

/** Run a command, returning { code, stdout, stderr }. Never throws. */
export function run(cmd, args = [], opts = {}) {
  const r = spawnSync(...spawnArgs(cmd, args), { encoding: 'utf8', shell: SHELL, ...opts });
  return {
    code: r.status ?? 1,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
    error: r.error,
  };
}

/** Run a command, printing output, and exit the process on failure. */
export function runOrExit(cmd, args = [], opts = {}) {
  const r = spawnSync(...spawnArgs(cmd, args), { stdio: 'inherit', shell: SHELL, ...opts });
  if ((r.status ?? 1) !== 0) {
    fail(`${cmd} ${args.join(' ')} exited with ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

/** Whether `cmd` is on the PATH (`which` on POSIX, `where` on Windows). */
export function has(cmd) {
  return run(process.platform === 'win32' ? 'where' : 'which', [cmd]).code === 0;
}

/** True when something is listening on the port. */
export function portOpen(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

export async function waitForPort(port, { label, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`timed out waiting for ${label ?? `port ${port}`}`);
  return false;
}

/** Docker Compose is available under either the plugin or the legacy binary. */
export function dockerCompose() {
  if (has('docker') && run('docker', ['compose', 'version']).code === 0) {
    return { cmd: 'docker', args: ['compose'] };
  }
  if (has('docker-compose')) return { cmd: 'docker-compose', args: [] };
  if (has('podman') && run('podman', ['compose', 'version']).code === 0) {
    return { cmd: 'podman', args: ['compose'] };
  }
  return null;
}
