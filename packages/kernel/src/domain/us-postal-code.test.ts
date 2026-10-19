import { describe, expect, it } from 'vitest';
import { isValidUsZip } from './us-postal-code.js';

describe('isValidUsZip', () => {
  it('accepts 5-digit and ZIP+4 formats', () => {
    expect(isValidUsZip('12345')).toBe(true);
    expect(isValidUsZip('12345-6789')).toBe(true);
    expect(isValidUsZip('  12345  ')).toBe(true); // trimmed before checking
  });

  it('rejects short, long, non-numeric, and foreign postal codes', () => {
    expect(isValidUsZip('1234')).toBe(false);
    expect(isValidUsZip('123456')).toBe(false);
    expect(isValidUsZip('ABCDE')).toBe(false);
    expect(isValidUsZip('SW1A 1AA')).toBe(false); // UK postcode
    expect(isValidUsZip('12345-')).toBe(false);
    expect(isValidUsZip('12345-67')).toBe(false);
  });
});
