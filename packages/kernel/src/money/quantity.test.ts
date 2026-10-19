import { describe, expect, it } from 'vitest';
import { MoneyError } from './money.js';
import { assertQuantity, formatQuantity, quantityFrom } from './quantity.js';

describe('assertQuantity', () => {
  it('accepts an integer count of ten-thousandths', () => {
    expect(assertQuantity(15000)).toBe(15000);
    expect(assertQuantity(0)).toBe(0);
    expect(assertQuantity(-15000)).toBe(-15000);
  });

  it('refuses a non-integer, naming the offending label', () => {
    expect(() => assertQuantity(1.5)).toThrow(/quantity must be an integer/);
    expect(() => assertQuantity(1.5, 'line quantity')).toThrow(/line quantity must be an integer/);
  });

  it('refuses a value outside the safe integer range', () => {
    expect(() => assertQuantity(Number.MAX_SAFE_INTEGER + 2)).toThrow(
      /exceeds the safe integer range/,
    );
  });
});

describe('quantityFrom', () => {
  it('scales a whole number by ten thousand', () => {
    expect(quantityFrom(12)).toBe(120000);
    expect(quantityFrom(0)).toBe(0);
  });

  it('refuses a fractional number, directing the caller to strings', () => {
    expect(() => quantityFrom(1.5)).toThrow(/pass fractional quantities as strings/);
  });

  it('parses decimal strings up to four places, including negatives', () => {
    expect(quantityFrom('1.5')).toBe(15000);
    expect(quantityFrom('0.3333')).toBe(3333);
    expect(quantityFrom('-2.25')).toBe(-22500);
    expect(quantityFrom('7')).toBe(70000);
  });

  it('refuses a string that is not a valid quantity', () => {
    expect(() => quantityFrom('abc')).toThrow(MoneyError);
    expect(() => quantityFrom('1.2.3')).toThrow(MoneyError);
    expect(() => quantityFrom('')).toThrow(MoneyError);
  });

  it('refuses more than four decimal places', () => {
    expect(() => quantityFrom('0.00001')).toThrow(
      /carries more than 4 decimal places of quantity precision/,
    );
  });

  it('refuses a string that overflows the safe integer range', () => {
    expect(() => quantityFrom('999999999999999999.9999')).toThrow(
      /overflows the safe integer range/,
    );
  });
});

describe('formatQuantity', () => {
  it('trims trailing zeroes and drops the decimal point entirely for whole numbers', () => {
    expect(formatQuantity(120000)).toBe('12');
    expect(formatQuantity(15000)).toBe('1.5');
    expect(formatQuantity(3333)).toBe('0.3333');
  });

  it('formats a negative quantity with the sign in front', () => {
    expect(formatQuantity(-15000)).toBe('-1.5');
    expect(formatQuantity(-3333)).toBe('-0.3333');
  });

  it('round-trips through quantityFrom for values already in canonical form', () => {
    for (const value of ['0', '1.5', '0.3333', '-2.25', '100']) {
      expect(formatQuantity(quantityFrom(value))).toBe(value);
    }
  });
});
