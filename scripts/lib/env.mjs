import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root — this file lives at <root>/scripts/lib/. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Unquotes, or strips a trailing ` # comment` from an unquoted value. */
export function parseValue(raw) {
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
 * Loads the root .env into process.env. An ambient value always wins, so
 * `API_PORT=4002 pnpm dev` overrides the file rather than the reverse.
 *
 * NODE_ENV is deliberately never loaded from the file: every command this
 * wraps (next dev, next build, next start, prisma, ...) already picks the
 * right one on its own, and forcing the file's NODE_ENV=development onto a
 * spawned `next build` corrupts the production output (Next prerenders the
 * app in dev mode and fails on the synthesized /404 page with a spurious
 * "<Html> should not be imported outside of pages/_document" error).
 *
 * Returns true when a .env was found. Callers that only need to read a couple
 * of settings (ports, say) get the same parse as the apps themselves, which is
 * the point: two implementations of "read the root .env" drift silently.
 */
export function loadRootEnv(envPath = path.join(ROOT, '.env')) {
  if (!fs.existsSync(envPath)) return false;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === 'NODE_ENV' || key in process.env) continue;
    process.env[key] = parseValue(line.slice(eq + 1));
  }
  return true;
}
