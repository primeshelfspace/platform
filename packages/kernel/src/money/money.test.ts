import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  SUPPORTED_CURRENCIES,
  addMinor,
  allocate,
  applyBasisPoints,
  assertMinor,
  divideRoundHalfUp,
  formatBasisPoints,
  formatMinor,
  formatMinorForDisplay,
  minorUnitExponent,
  isPositive,
  isSupportedCurrency,
  isZero,
  maxMinor,
  minMinor,
  negateMinor,
  parseBasisPoints,
  parseMinor,
  subtractMinor,
  toCurrencyCode,
} from './money.js';
import { formatQuantity, quantityFrom } from './quantity.js';

describe('divideRoundHalfUp', () => {
  it('rounds ties away from zero', () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideRoundHalfUp(3n, 2n)).toBe(2n);
    expect(divideRoundHalfUp(1n, 3n)).toBe(0n);
    expect(divideRoundHalfUp(2n, 3n)).toBe(1n);
  });

  it('normalises a negative denominator', () => {
    expect(divideRoundHalfUp(5n, -2n)).toBe(-3n);
  });

  it('refuses division by zero', () => {
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(MoneyError);
  });
});

describe('parseMinor', () => {
  it('parses decimal strings exactly', () => {
    expect(parseMinor('1234.56')).toBe(123456);
    expect(parseMinor('0.01')).toBe(1);
    expect(parseMinor('100')).toBe(10000);
    expect(parseMinor('-42.50')).toBe(-4250);
    expect(parseMinor('1,234.56')).toBe(123456);
  });

  it('refuses more precision than the currency holds', () => {
    expect(() => parseMinor('1.005')).toThrow(MoneyError);
  });

  it('refuses junk', () => {
    expect(() => parseMinor('abc')).toThrow(MoneyError);
    expect(() => parseMinor('')).toThrow(MoneyError);
  });

  it('round-trips through formatMinor', () => {
    for (const value of ['0.00', '0.07', '19.99', '1234.56', '-3.05']) {
      expect(formatMinor(parseMinor(value))).toBe(value);
    }
  });
});

describe('formatMinorForDisplay', () => {
  it('renders a localised currency string', () => {
    expect(formatMinorForDisplay(339248, 'USD', 'en-US')).toBe('$3,392.48');
  });
});

describe('applyBasisPoints', () => {
  it('applies a rate with a single half-up rounding', () => {
    expect(applyBasisPoints(311025, 600)).toBe(18662);
    expect(applyBasisPoints(329687, 290)).toBe(9561);
    expect(applyBasisPoints(100, 0)).toBe(0);
  });

  it('refuses a negative rate', () => {
    expect(() => applyBasisPoints(100, -100)).toThrow(MoneyError);
  });
});

describe('integer guards', () => {
  it('refuses a non-integer amount anywhere it enters the module', () => {
    expect(() => addMinor(1.5)).toThrow(MoneyError);
    expect(() => subtractMinor(1, 0.5)).toThrow(MoneyError);
    expect(() => applyBasisPoints(10.1, 100)).toThrow(MoneyError);
  });

  it('adds, subtracts and negates', () => {
    expect(addMinor(100, 250, -50)).toBe(300);
    expect(subtractMinor(100, 250)).toBe(-150);
    expect(negateMinor(100)).toBe(-100);
    expect(maxMinor(1, 2)).toBe(2);
    expect(minMinor(1, 2)).toBe(1);
  });
});

describe('allocate', () => {
  it('never loses or invents a minor unit', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [1, 1])).toEqual([5, 5]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  it('allocates proportionally', () => {
    const parts = allocate(1000, [3, 1]);
    expect(parts).toEqual([750, 250]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('puts everything in the first slot when all weights are zero', () => {
    expect(allocate(500, [0, 0, 0])).toEqual([500, 0, 0]);
  });

  it('refuses empty or negative weights', () => {
    expect(() => allocate(100, [])).toThrow(MoneyError);
    expect(() => allocate(100, [-1, 2])).toThrow(MoneyError);
  });
});

describe('basis point formatting', () => {
  it('formats and parses percentages', () => {
    expect(formatBasisPoints(600)).toBe('6%');
    expect(parseBasisPoints('2.9')).toBe(290);
    expect(parseBasisPoints('6%')).toBe(600);
    expect(parseBasisPoints(7)).toBe(700);
    expect(() => parseBasisPoints('abc')).toThrow(MoneyError);
  });
});

describe('quantity', () => {
  it('parses and formats four-decimal fixed point', () => {
    expect(quantityFrom('1.5')).toBe(15000);
    expect(quantityFrom('0.3333')).toBe(3333);
    expect(quantityFrom(12)).toBe(120000);
    expect(formatQuantity(15000)).toBe('1.5');
    expect(formatQuantity(120000)).toBe('12');
    expect(formatQuantity(3333)).toBe('0.3333');
  });

  it('refuses a fractional number argument, directing the caller to strings', () => {
    expect(() => quantityFrom(1.5)).toThrow(/pass fractional quantities as strings/);
  });

  it('refuses more than four decimal places', () => {
    expect(() => quantityFrom('0.00001')).toThrow(MoneyError);
  });
});

describe('toCurrencyCode', () => {
  it('passes through a supported code', () => {
    expect(toCurrencyCode('EUR')).toBe('EUR');
  });

  it('falls back to USD by default for anything unsupported', () => {
    expect(toCurrencyCode('XYZ')).toBe('USD');
    expect(toCurrencyCode(null)).toBe('USD');
    expect(toCurrencyCode(undefined)).toBe('USD');
  });

  it('falls back to the caller-supplied default instead of USD when given one', () => {
    expect(toCurrencyCode('XYZ', 'GBP')).toBe('GBP');
  });
});

describe('overflow guards', () => {
  it('refuses a minor amount outside the safe integer range', () => {
    expect(() => assertMinor(Number.MAX_SAFE_INTEGER + 2)).toThrow(
      /exceeds the safe integer range/,
    );
  });

  it('refuses a sum that overflows the safe integer range', () => {
    expect(() => addMinor(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow(
      /overflows the safe integer range/,
    );
  });
});

describe('amount predicates', () => {
  it('distinguishes zero, positive and negative balances', () => {
    expect(isZero(0)).toBe(true);
    expect(isZero(1)).toBe(false);
    expect(isPositive(1)).toBe(true);
    // A cleared balance is not an outstanding one.
    expect(isPositive(0)).toBe(false);
    // Overpayment leaves a negative balance, which is a real state.
    expect(isPositive(-1)).toBe(false);
  });

  it('refuses a non-integer amount', () => {
    expect(() => isZero(0.5)).toThrow(MoneyError);
    expect(() => isPositive(1.5)).toThrow(MoneyError);
  });
});

describe('minorUnitExponent', () => {
  it('reports the decimal places for every supported currency', () => {
    // All four are 2-decimal today, so this asserts the lookup works rather
    // than a difference between them. It matters because the Zoho adapter
    // scales by this instead of a hardcoded 100 — adding JPY (0 decimals) or
    // KWD (3) must not silently mis-scale every amount crossing that boundary.
    expect(minorUnitExponent('USD')).toBe(2);
    expect(minorUnitExponent('CAD')).toBe(2);
    expect(minorUnitExponent('EUR')).toBe(2);
    expect(minorUnitExponent('GBP')).toBe(2);
  });

  it('agrees with what formatMinor actually renders', () => {
    // The guard against the table drifting from the formatter: a currency whose
    // exponent said 2 but which rendered 3 decimals would corrupt every
    // conversion while both functions individually looked correct.
    for (const currency of SUPPORTED_CURRENCIES) {
      const rendered = formatMinor(1, currency);
      expect(rendered.split('.')[1]).toHaveLength(minorUnitExponent(currency));
    }
  });
});

describe('isSupportedCurrency', () => {
  it('accepts every supported code', () => {
    for (const currency of SUPPORTED_CURRENCIES) {
      expect(isSupportedCurrency(currency)).toBe(true);
    }
  });

  it('rejects currencies this platform cannot represent', () => {
    // The two shapes that would corrupt an amount if waved through: JPY has no
    // minor unit at all, KWD has three. ZohoPullService refuses an invoice in
    // either rather than storing a number that is 100x or 10x wrong.
    expect(isSupportedCurrency('JPY')).toBe(false);
    expect(isSupportedCurrency('KWD')).toBe(false);
    expect(isSupportedCurrency('BTC')).toBe(false);
  });

  it('rejects absent and malformed input', () => {
    expect(isSupportedCurrency(null)).toBe(false);
    expect(isSupportedCurrency(undefined)).toBe(false);
    expect(isSupportedCurrency('')).toBe(false);
    expect(isSupportedCurrency('usd')).toBe(false); // case-sensitive by design
  });

  it('narrows the type, not just the value', () => {
    // The reason this exists alongside toCurrencyCode: that one substitutes a
    // fallback, which is right for our own values and wrong for provider data.
    const fromProvider: string = 'GBP';
    if (isSupportedCurrency(fromProvider)) {
      expect(minorUnitExponent(fromProvider)).toBe(2);
    } else {
      throw new Error('GBP should be supported');
    }
  });
});
