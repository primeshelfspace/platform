#!/usr/bin/env node
/**
 * Runs a command with the repository-root .env loaded.
 *
 * The Prisma CLI looks for .env beside the schema or in the working directory,
 * neither of which is the monorepo root. Rather than keep a second copy of the
 * environment per app — which drifts, and drifts silently — every app reads the
 * single root .env through this wrapper.
 *
 *   node ../../scripts/with-env.mjs prisma migrate deploy
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(ROOT, '.env');

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key in process.env) continue;
    process.env[key] = parseValue(line.slice(eq + 1));
  }
}

/** Unquotes, or strips a trailing ` # comment` from an unquoted value. */
function parseValue(raw) {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  const comment = value.search(/\s#/);
  return comment === -1 ? value : value.slice(0, comment).trim();
}

/**
 * Expands bash-style ${VAR:-default} tokens.
 *
 * The call sites must single-quote these in package.json, or a POSIX shell
 * expands them itself before this process starts — and it expands them against
 * the ambient environment, which does NOT yet contain .env (that is loaded
 * above, inside this process). The token would silently resolve to the
 * default, so `ADMIN_PORT` in .env was ignored on macOS and Linux while
 * appearing to work.
 *
 * Those same quotes are why this also has to strip a leftover matching pair
 * afterward: a POSIX shell consumes single quotes as its own quoting syntax
 * before this process ever sees the argument, but cmd.exe on Windows has no
 * such syntax and passes them through as literal characters — without this,
 * `'${ADMIN_PORT:-3000}'` expands to the 8-character string `'3000'` there,
 * which every consumer (next dev --port, etc.) rejects as not a number.
 */
function expandDefault(arg) {
  const expanded = arg.replace(
    /\$\{([A-Z_][A-Z0-9_]*):-([^}]*)\}/g,
    (_, name, fallback) => process.env[name] ?? fallback,
  );
  if (
    (expanded.startsWith("'") && expanded.endsWith("'")) ||
    (expanded.startsWith('"') && expanded.endsWith('"'))
  ) {
    return expanded.slice(1, -1);
  }
  return expanded;
}

const [command, ...rawArgs] = process.argv.slice(2);
if (!command) {
  process.stderr.write('usage: with-env.mjs <command> [args...]\n');
  process.exit(1);
}
const args = rawArgs.map(expandDefault);

const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
