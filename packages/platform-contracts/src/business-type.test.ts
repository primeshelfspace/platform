import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES, isBusinessType } from './business-type.js';

describe('isBusinessType', () => {
  it('accepts every declared business type', () => {
    for (const type of BUSINESS_TYPES) {
      expect(isBusinessType(type)).toBe(true);
    }
  });

  it('refuses a string that is not a declared type', () => {
    expect(isBusinessType('SOLE_TRADER')).toBe(false);
    expect(isBusinessType('')).toBe(false);
  });

  it('refuses non-string input rather than throwing', () => {
    expect(isBusinessType(undefined)).toBe(false);
    expect(isBusinessType(null)).toBe(false);
    expect(isBusinessType(42)).toBe(false);
  });
});
