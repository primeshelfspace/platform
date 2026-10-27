/**
 * Re-encrypts every stored integration credential from one
 * CREDENTIAL_ENCRYPTION_KEY to another, in both databases: the platform's
 * integration_connection (Square, Authorize.Net, ...) and Sugrpay's
 * zoho_connection. Without this, changing the key leaves every connection
 * undecryptable and every brand has to reconnect.
 *
 *   OLD_CREDENTIAL_ENCRYPTION_KEY=<current key> pnpm db:rotate-credential-key
 *
 * The new key is the CREDENTIAL_ENCRYPTION_KEY in .env, so the order is: put
 * the new key in .env, run this with the old one in OLD_..., restart the APIs.
 * Safe to re-run: a value that already decrypts under the new key is left
 * alone, and a value neither key can read is reported, never overwritten.
 */
import {
  decryptCredential,
  encryptCredential,
} from '../../packages/server/src/common/credential-encryption.js';
import { PrismaClient as InvoicingClient } from '../../apps/sugrpay/generated/index.js';
import { PrismaClient as PlatformClient } from '../../apps/platform/generated/index.js';

function key(name: string): string {
  const value = process.env[name];
  if (!value || Buffer.from(value, 'base64').length !== 32) {
    throw new Error(`${name} must be set to a 32-byte base64 key`);
  }
  return value;
}

const oldKey = key('OLD_CREDENTIAL_ENCRYPTION_KEY');
const newKey = key('CREDENTIAL_ENCRYPTION_KEY');
if (oldKey === newKey) {
  throw new Error(
    'CREDENTIAL_ENCRYPTION_KEY in .env is still the old key — put the new one there first',
  );
}

function readsWith(stored: string, k: string): boolean {
  try {
    decryptCredential(stored, k);
    return true;
  } catch {
    return false;
  }
}

/** New ciphertext, or null when nothing needs writing (already rotated). */
function rotate(stored: string, label: string): string | null {
  if (readsWith(stored, newKey)) return null;
  if (!readsWith(stored, oldKey))
    throw new Error(`${label}: readable with neither key, left as is`);
  return encryptCredential(decryptCredential(stored, oldKey), newKey);
}

const platform = new PlatformClient({
  datasources: {
    db: {
      url: process.env['PLATFORM_DIRECT_DATABASE_URL'] ?? process.env['PLATFORM_DATABASE_URL'],
    },
  },
});
const invoicing = new InvoicingClient({
  datasources: {
    db: {
      url: process.env['INVOICING_DIRECT_DATABASE_URL'] ?? process.env['INVOICING_DATABASE_URL'],
    },
  },
});

async function main(): Promise<void> {
  let rotated = 0;
  let unchanged = 0;
  const problems: string[] = [];

  const platformRows = await platform.integrationConnection.findMany({
    where: { encryptedCredentials: { not: null } },
    select: { id: true, provider: true, encryptedCredentials: true },
  });
  for (const row of platformRows) {
    const label = `integration_connection ${row.id} (${row.provider})`;
    try {
      const next = rotate(row.encryptedCredentials!, label);
      if (next === null) unchanged++;
      else {
        await platform.integrationConnection.update({
          where: { id: row.id },
          data: { encryptedCredentials: next },
        });
        rotated++;
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  const zohoRows = await invoicing.zohoConnection.findMany({
    where: { encryptedCredentials: { not: null } },
    select: { brandId: true, encryptedCredentials: true },
  });
  for (const row of zohoRows) {
    const label = `zoho_connection for brand ${row.brandId}`;
    try {
      const next = rotate(row.encryptedCredentials!, label);
      if (next === null) unchanged++;
      else {
        await invoicing.zohoConnection.update({
          where: { brandId: row.brandId },
          data: { encryptedCredentials: next },
        });
        rotated++;
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  console.log(`re-encrypted ${rotated}, already on the new key ${unchanged}`);
  for (const problem of problems) console.warn(`  ! ${problem}`);
  if (problems.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([platform.$disconnect(), invoicing.$disconnect()]));
