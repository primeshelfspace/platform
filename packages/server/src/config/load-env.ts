/**
 * Loads the repository-root .env into process.env without a dependency.
 *
 * Deployed environments inject real environment variables and never see a .env
 * file, so anything already set wins — this only fills gaps.
 */
import fs from 'node:fs';
import path from 'node:path';

let loaded = false;

export function loadEnv(startDir = process.cwd()): void {
  if (loaded) return;
  loaded = true;

  const envPath = findUp('.env', startDir);
  if (!envPath) return;

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

/**
 * Unquotes a value, or strips a trailing ` # comment` from an unquoted one.
 * Without this, `MAIL_DRIVER=smtp   # smtp | postmark` reaches the schema as
 * the whole string and fails validation with a confusing message.
 */
function parseValue(raw: string): string {
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

function findUp(filename: string, from: string): string | null {
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
