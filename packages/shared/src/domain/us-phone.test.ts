import { describe, expect, it } from 'vitest';
import { isValidUsPhone, normalizeUsPhone } from './us-phone.js';

describe('normalizeUsPhone', () => {
  it('accepts common US formats and normalizes each to E.164', () => {
    expect(normalizeUsPhone('(212) 555-1234')).toBe('+12125551234');
    expect(normalizeUsPhone('212-555-1234')).toBe('+12125551234');
    expect(normalizeUsPhone('2125551234')).toBe('+12125551234');
    expect(normalizeUsPhone('+1 212 555 1234')).toBe('+12125551234');
    expect(normalizeUsPhone('1-212-555-1234')).toBe('+12125551234');
    expect(normalizeUsPhone('  212.555.1234  ')).toBe('+12125551234');
  });

  it('rejects non-US country codes', () => {
    expect(normalizeUsPhone('+44 20 7946 0958')).toBeNull();
    expect(normalizeUsPhone('+91 22 1234 5678')).toBeNull();
  });

  it('rejects malformed numbers', () => {
    expect(normalizeUsPhone('555-1234')).toBeNull(); // too short
    expect(normalizeUsPhone('212-555-12345')).toBeNull(); // too long
    expect(normalizeUsPhone('123-555-1234')).toBeNull(); // area code can't start with 1
    expect(normalizeUsPhone('212-155-1234')).toBeNull(); // exchange code can't start with 1
    expect(normalizeUsPhone('not-a-phone')).toBeNull();
    expect(normalizeUsPhone('')).toBeNull();
  });

  it('isValidUsPhone mirrors normalizeUsPhone', () => {
    expect(isValidUsPhone('(212) 555-1234')).toBe(true);
    expect(isValidUsPhone('+44 20 7946 0958')).toBe(false);
  });
});
