#!/usr/bin/env node
/**
 * Brings local dependency services up or down.
 *
 * Docker Compose is the documented path (TER-001 §3.1). When Docker is not
 * installed, this falls back to Homebrew-managed PostgreSQL and Redis plus the
 * in-repo mail sink, so a workstation without Docker can still run the stack.
 *
 *   node scripts/services.mjs up|down|status
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  c,
  log,
  step,
  ok,
  warn,
  fail,
  run,
  has,
  portOpen,
  waitForPort,
  dockerCompose,
} from './lib/proc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_DIR = path.join(ROOT, '.local');
const PID_FILE = path.join(LOCAL_DIR, 'mail-sink.pid');

const DB_NAME = 'sugrpay';
const DB_OWNER = 'sugrpay';
const DB_OWNER_PASSWORD = 'sugrpay';
const DB_APP_ROLE = 'sugrpay_app';
const DB_APP_PASSWORD = 'sugrpay_app';

const action = process.argv[2] ?? 'up';

const compose = dockerCompose();
const mode = compose ? 'docker' : 'native';

if (action === 'up') await up();
else if (action === 'down') await down();
else if (action === 'status') await status();
else {
  fail(`unknown action "${action}" — expected up, down or status`);
  process.exit(1);
}

async function up() {
  log(`${c.bold}Local services${c.reset} ${c.dim}(${mode} mode)${c.reset}`);
  if (mode === 'docker') await upDocker();
  else await upNative();
  log();
  await status();
}

async function upDocker() {
  step('starting postgres, redis, mailcatcher and minio via Compose');
  const r = run(compose.cmd, [...compose.args, 'up', '-d'], { cwd: ROOT, stdio: 'inherit' });
  if (r.code !== 0) {
    fail('compose up failed');
    process.exit(1);
  }
  await waitForPort(5432, { label: 'postgres' });
  await waitForPort(6379, { label: 'redis' });
  ok('containers running');
}

async function upNative() {
  warn('Docker not found — using locally installed services instead.');
  log(
    `${c.dim}  Compose remains the supported path; install Docker Desktop or Podman to use it.${c.reset}`,
  );

  await ensurePostgres();
  await ensureRedis();
  await ensureMailSink();
}

async function ensurePostgres() {
  step('postgres');
  if (!(await portOpen(5432))) {
    if (!has('brew')) {
      fail('postgres is not running on :5432 and Homebrew is unavailable to start it');
      process.exit(1);
    }
    const formula = detectBrewFormula(['postgresql@16', 'postgresql@15', 'postgresql@14']);
    if (!formula) {
      fail('no Homebrew postgresql formula installed — run: brew install postgresql@16');
      process.exit(1);
    }
    run('brew', ['services', 'start', formula], { stdio: 'inherit' });
    if (!(await waitForPort(5432, { label: 'postgres', timeoutMs: 30_000 }))) process.exit(1);
  }
  ok('postgres listening on :5432');

  // Roles and database. Idempotent: safe to re-run.
  psqlAdmin(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_OWNER}') THEN
        CREATE ROLE ${DB_OWNER} LOGIN PASSWORD '${DB_OWNER_PASSWORD}' CREATEDB;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_APP_ROLE}') THEN
        CREATE ROLE ${DB_APP_ROLE} LOGIN PASSWORD '${DB_APP_PASSWORD}';
      END IF;
    END $$;`);

  const exists = psqlAdmin(
    `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`,
    'postgres',
    true,
  );
  if (!exists.stdout.includes('1')) {
    psqlAdmin(`CREATE DATABASE ${DB_NAME} OWNER ${DB_OWNER}`);
    ok(`database "${DB_NAME}" created`);
  } else {
    ok(`database "${DB_NAME}" present`);
  }
  ok(`roles "${DB_OWNER}" (owner) and "${DB_APP_ROLE}" (runtime, RLS-bound) present`);
}

function detectBrewFormula(candidates) {
  const installed = run('brew', ['list', '--formula']).stdout.split('\n');
  return candidates.find((f) => installed.includes(f)) ?? null;
}

function psqlAdmin(sql, db = 'postgres', tuplesOnly = false) {
  const args = ['-d', db, '-v', 'ON_ERROR_STOP=1'];
  if (tuplesOnly) args.push('-tA');
  args.push('-c', sql);
  const r = run('psql', args);
  if (r.code !== 0 && !tuplesOnly) {
    fail(`psql failed: ${r.stderr}`);
    process.exit(1);
  }
  return r;
}

async function ensureRedis() {
  step('redis');
  if (!(await portOpen(6379))) {
    if (!has('brew') || !detectBrewFormula(['redis'])) {
      fail('redis is not running on :6379 — run: brew install redis');
      process.exit(1);
    }
    run('brew', ['services', 'start', 'redis'], { stdio: 'inherit' });
    if (!(await waitForPort(6379, { label: 'redis', timeoutMs: 30_000 }))) process.exit(1);
  }
  ok('redis listening on :6379');
}

async function ensureMailSink() {
  step('mail sink');
  if (await portOpen(1025)) {
    ok('SMTP sink already listening on :1025');
    return;
  }
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  const out = fs.openSync(path.join(LOCAL_DIR, 'mail-sink.log'), 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'mail-sink.mjs')], {
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
  if (!(await waitForPort(1025, { label: 'mail sink', timeoutMs: 10_000 }))) process.exit(1);
  ok('SMTP sink on :1025, web UI on http://localhost:1080');
}

async function down() {
  log(`${c.bold}Stopping local services${c.reset} ${c.dim}(${mode} mode)${c.reset}`);
  if (mode === 'docker') {
    run(compose.cmd, [...compose.args, 'down'], { cwd: ROOT, stdio: 'inherit' });
    ok('containers stopped');
    return;
  }

  if (fs.existsSync(PID_FILE)) {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    try {
      process.kill(pid);
      ok(`mail sink (pid ${pid}) stopped`);
    } catch {
      warn('mail sink was not running');
    }
    fs.unlinkSync(PID_FILE);
  }
  warn('postgres and redis are Homebrew services and were left running.');
  log(
    `${c.dim}  Stop them with: brew services stop redis && brew services stop postgresql@14${c.reset}`,
  );
}

async function status() {
  const checks = [
    ['postgres', 5432, 'postgresql://localhost:5432/sugrpay'],
    ['redis', 6379, 'redis://localhost:6379'],
    ['mail (smtp)', 1025, 'smtp://localhost:1025'],
    ['mail (ui)', 1080, 'http://localhost:1080'],
  ];
  if (mode === 'docker') checks.push(['minio', 9000, 'http://localhost:9000']);

  log(`${c.bold}Service status${c.reset}`);
  for (const [label, port, url] of checks) {
    const isUp = await portOpen(port);
    log(
      `  ${isUp ? `${c.green}●${c.reset}` : `${c.red}○${c.reset}`} ${label.padEnd(12)} ${c.dim}${url}${c.reset}`,
    );
  }
}
