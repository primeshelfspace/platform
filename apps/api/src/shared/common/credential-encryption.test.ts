import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptCredential, encryptCredential } from './credential-encryption.js';

const KEY = randomBytes(32).toString('base64');

describe('credential encryption', () => {
  it('round-trips a plaintext value exactly', () => {
    const secret = 'zoho-refresh-token-1000.abc123.def456';
    const encrypted = encryptCredential(secret, KEY);
    expect(decryptCredential(encrypted, KEY)).toBe(secret);
  });

  it('produces a different ciphertext for the same plaintext each time', () => {
    const secret = 'same-secret';
    const a = encryptCredential(secret, KEY);
    const b = encryptCredential(secret, KEY);
    expect(a).not.toBe(b); // random IV per call — never reused
    expect(decryptCredential(a, KEY)).toBe(secret);
    expect(decryptCredential(b, KEY)).toBe(secret);
  });

  it('refuses to decrypt with the wrong key', () => {
    const encrypted = encryptCredential('secret', KEY);
    const wrongKey = randomBytes(32).toString('base64');
    expect(() => decryptCredential(encrypted, wrongKey)).toThrow();
  });

  it('refuses a tampered ciphertext rather than returning garbage', () => {
    const encrypted = encryptCredential('secret', KEY);
    const [iv, tag, data] = encrypted.split(':');
    const tamperedByte = Buffer.from(data!, 'base64');
    tamperedByte[0] = (tamperedByte[0]! + 1) % 256;
    const tampered = [iv, tag, tamperedByte.toString('base64')].join(':');
    expect(() => decryptCredential(tampered, KEY)).toThrow();
  });

  it('rejects a malformed stored value instead of crashing unpredictably', () => {
    expect(() => decryptCredential('not-the-right-format', KEY)).toThrow(/malformed/);
  });
});
