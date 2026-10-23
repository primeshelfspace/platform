#!/usr/bin/env node
/**
 * Checks an env file with the API's own config schema, without starting it.
 *
 *   node deploy/production/check-env.mjs [path/to/.env]   (default: the repo's .env)
 *
 * Prints "config valid: …" and exits 0, or "config INVALID: …" and exits 1.
 * Needs the built shared package (packages/server/dist); `bash deploy/deploy.sh` builds it.
 * update-secrets.sh runs this before it replaces the live .env.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRootEnv, ROOT } from '../../scripts/lib/env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
loadRootEnv(process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '.env'));
const { getEnv } = await import(
  pathToFileURL(path.join(here, '../../packages/server/dist/config/env.js')).href
);
try {
  const e = getEnv();
  console.log(
    `config valid: ${e.APP_ENV} | gateway ${e.PAYMENT_GATEWAY_DRIVER} | mail ${e.MAIL_DRIVER} | storage ${e.STORAGE_DRIVER} | accounting ${e.ACCOUNTING_DRIVER}`,
  );
} catch (err) {
  console.log('config INVALID:', err instanceof Error ? err.message : err);
  process.exit(1);
}
