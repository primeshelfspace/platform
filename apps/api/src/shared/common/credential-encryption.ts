import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for integration credentials (TDD-001 §15.2) — refresh
 * tokens, API secrets, anything IntegrationConnection.encryptedCredentials
 * holds. AES-256-GCM specifically: authenticated, so a tampered ciphertext
 * fails to decrypt rather than silently returning garbage that gets sent to
 * a provider as a credential.
 *
 * CREDENTIAL_ENCRYPTION_KEY is a single shared key today (TSD-001 doubles
 * this as a per-tenant scheme in production — see NFR-SEC-004). Swapping to
 * per-brand keys later changes only these two functions' key lookup, not any
 * call site.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit, the value GCM is defined and optimised for

export function encryptCredential(plaintext: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString('base64')).join(':');
}

export function decryptCredential(stored: string, keyBase64: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('malformed encrypted credential — expected iv:authTag:ciphertext');
  }
  const key = Buffer.from(keyBase64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // Throws if authTag does not match — a tampered or corrupted value is
  // refused here rather than decrypted into whatever bytes fall out.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
