import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptFile, encryptFile, isEncryptedFile } from './file-encryption.js';

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2048)]);

describe('file encryption', () => {
  it('round-trips, and the stored bytes are not the image', () => {
    const stored = encryptFile(JPEG, KEY, 'check-image');

    expect(isEncryptedFile(stored)).toBe(true);
    expect(stored.includes(JPEG.subarray(0, 64))).toBe(false);
    expect(decryptFile(stored, KEY, 'check-image').equals(JPEG)).toBe(true);
  });

  it('gives different bytes each time for the same image', () => {
    expect(
      encryptFile(JPEG, KEY, 'check-image').equals(encryptFile(JPEG, KEY, 'check-image')),
    ).toBe(false);
  });

  it('refuses another key, another purpose, and a changed file', () => {
    const stored = encryptFile(JPEG, KEY, 'check-image');
    expect(() => decryptFile(stored, OTHER_KEY, 'check-image')).toThrow();
    expect(() => decryptFile(stored, KEY, 'logo')).toThrow();

    const tampered = Buffer.from(stored);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptFile(tampered, KEY, 'check-image')).toThrow();
  });

  it('tells a file stored before encryption from an encrypted one', () => {
    expect(isEncryptedFile(JPEG)).toBe(false);
    expect(() => decryptFile(JPEG, KEY, 'check-image')).toThrow('not an encrypted file');
  });
});
