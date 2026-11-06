import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encryption for files we store, done in the application before the bytes
 * reach storage: AES-256-GCM, so a changed or corrupted file fails to decrypt
 * rather than returning garbage. The storage provider's own encryption at
 * rest (S3 SSE) still applies on top; this means a copy of the object, a
 * leaked storage link or a misconfigured bucket gives encrypted bytes only.
 *
 * The key is derived from CREDENTIAL_ENCRYPTION_KEY per purpose (HKDF-SHA256,
 * e.g. "check-image"), so no new secret has to be deployed and a file key is
 * never the same as the credential key.
 *
 * Layout: MAGIC (8 bytes) | iv (12) | auth tag (16) | ciphertext.
 */
const MAGIC = Buffer.from('SPENC01\0', 'latin1');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function fileKey(keyBase64: string, purpose: string): Buffer {
  const master = Buffer.from(keyBase64, 'base64');
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `sugrpay-file:${purpose}`, 32));
}

/** Whether these bytes are a file encryptFile wrote (as opposed to one
 * stored before files were encrypted). */
export function isEncryptedFile(stored: Buffer): boolean {
  return (
    stored.length > MAGIC.length + IV_LENGTH + TAG_LENGTH &&
    stored.subarray(0, MAGIC.length).equals(MAGIC)
  );
}

export function encryptFile(plaintext: Buffer, keyBase64: string, purpose: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, fileKey(keyBase64, purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptFile(stored: Buffer, keyBase64: string, purpose: string): Buffer {
  if (!isEncryptedFile(stored)) throw new Error('not an encrypted file');
  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const tag = stored.subarray(MAGIC.length + IV_LENGTH, MAGIC.length + IV_LENGTH + TAG_LENGTH);
  const ciphertext = stored.subarray(MAGIC.length + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, fileKey(keyBase64, purpose), iv);
  decipher.setAuthTag(tag);
  // Throws when the tag does not match: tampered, corrupted, or another key.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
