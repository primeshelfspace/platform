/**
 * Money — integer minor units, end to end.
 *
 * TDD-001 §9.1 and NFR-INT-001: JavaScript has no decimal type and its `number`
 * is an IEEE-754 double. Every monetary value in this system is therefore a
 * signed integer count of the currency's minor unit (USD 1,234.56 → 123456),
 * and every rate is an integer count of basis points (6% → 600).
 *
 * All arithmetic that can exceed the safe-integer range mid-computation is done
 * in BigInt and narrowed back on the way out, so a large quantity multiplied by
 * a large unit price cannot silently lose precision.
 *
 * Nothing in this file performs I/O or imports a framework type.
 */

/** A signed integer count of a currency's minor unit. */
export type Minor = number;

/** An integer count of basis points. 6% is 600; 2.9% is 290. */
export type BasisPoints = number;

export const BASIS_POINTS_SCALE = 10_000n;

/** ISO 4217 codes the platform supports at MVP. */
export const SUPPORTED_CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** Minor units per major unit, per currency. All MVP currencies are 2-decimal. */
const MINOR_UNIT_EXPONENT: Record<CurrencyCode, number> = {
  USD: 2,
  CAD: 2,
  EUR: 2,
  GBP: 2,
};

/**
 * Narrows a currency string coming back over the wire.
 *
 * Call sites previously wrote `invoice.currency as 'USD'` — which is a lie to
 * the compiler, not a check: the runtime value could be any of the supported
 * codes, or something unsupported entirely, and the cast hid both. This
 * validates and falls back visibly instead.
 */
export function toCurrencyCode(
  value: string | null | undefined,
  fallback: CurrencyCode = 'USD',
): CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value ?? '')
    ? (value as CurrencyCode)
    : fallback;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Throws unless the value is a safe, whole integer. */
export function assertMinor(value: number, label = 'amount'): Minor {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer in minor units, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range: ${value}`);
  }
  return value;
}

export function assertBasisPoints(value: number, label = 'rate'): BasisPoints {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of basis points, received ${value}`);
  }
  if (value < 0) throw new MoneyError(`${label} must not be negative, received ${value}`);
  return value;
}

function toSafeNumber(value: bigint, label = 'result'): Minor {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`${label} overflows the safe integer range: ${value}`);
  }
  return Number(value);
}

/**
 * Integer division rounded half away from zero — the "half-up" of TDD-001 §9.1.
 *
 * Half *away from zero* rather than half *toward positive infinity* so that a
 * credit of -0.005 and a charge of +0.005 round to the same magnitude. Applied
 * only at the three points named in §9.2; never intermediately.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError('division by zero');
  if (denominator < 0n) return divideRoundHalfUp(-numerator, -denominator);

  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  // floor((magnitude + denominator/2) / denominator), kept in integers.
  const rounded = (magnitude * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

export function addMinor(...amounts: Minor[]): Minor {
  const total = amounts.reduce<bigint>((acc, a) => acc + BigInt(assertMinor(a)), 0n);
  return toSafeNumber(total, 'sum');
}

export function subtractMinor(a: Minor, b: Minor): Minor {
  return toSafeNumber(BigInt(assertMinor(a)) - BigInt(assertMinor(b)), 'difference');
}

export function negateMinor(a: Minor): Minor {
  return -assertMinor(a);
}

/** Applies a basis-point rate to an amount, rounding half-up once at the end. */
export function applyBasisPoints(amount: Minor, rateBp: BasisPoints): Minor {
  assertMinor(amount);
  assertBasisPoints(rateBp);
  const result = divideRoundHalfUp(BigInt(amount) * BigInt(rateBp), BASIS_POINTS_SCALE);
  return toSafeNumber(result, 'rate application');
}

export function isZero(amount: Minor): boolean {
  return assertMinor(amount) === 0;
}

export function isPositive(amount: Minor): boolean {
  return assertMinor(amount) > 0;
}

export function maxMinor(a: Minor, b: Minor): Minor {
  return assertMinor(a) >= assertMinor(b) ? a : b;
}

export function minMinor(a: Minor, b: Minor): Minor {
  return assertMinor(a) <= assertMinor(b) ? a : b;
}

/**
 * Distributes an amount across `weights` without losing or inventing a minor
 * unit. Largest-remainder allocation; the residue goes to the earliest slots.
 * Used for proportional tax and fee attribution on partial settlement.
 */
export function allocate(amount: Minor, weights: number[]): Minor[] {
  assertMinor(amount);
  if (weights.length === 0) throw new MoneyError('allocate requires at least one weight');
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new MoneyError('allocation weights must be non-negative finite numbers');
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    // No signal to allocate on: give everything to the first slot.
    return weights.map((_, i) => (i === 0 ? amount : 0));
  }

  const scaled = weights.map((w) => Math.round(w * 1_000_000));
  const scaledTotal = scaled.reduce((a, b) => a + b, 0);

  const base = scaled.map((w) =>
    toSafeNumber(
      (BigInt(amount) * BigInt(w)) / BigInt(scaledTotal === 0 ? 1 : scaledTotal),
      'allocation',
    ),
  );
  let remainder = amount - base.reduce((a, b) => a + b, 0);

  const step = remainder >= 0 ? 1 : -1;
  const result = [...base];
  for (let i = 0; remainder !== 0; i = (i + 1) % result.length) {
    result[i] = (result[i] ?? 0) + step;
    remainder -= step;
  }
  return result;
}

/** Minor units → major-unit decimal string. No locale, no symbol. */
export function formatMinor(amount: Minor, currency: CurrencyCode = 'USD'): string {
  assertMinor(amount);
  const exponent = MINOR_UNIT_EXPONENT[currency];
  const divisor = 10 ** exponent;
  const negative = amount < 0;
  const magnitude = Math.abs(amount);
  const major = Math.trunc(magnitude / divisor);
  const minor = magnitude % divisor;
  return `${negative ? '-' : ''}${major}.${String(minor).padStart(exponent, '0')}`;
}

/** Locale-aware presentation. Display only — never feed the result back in. */
export function formatMinorForDisplay(
  amount: Minor,
  currency: CurrencyCode = 'USD',
  locale = 'en-US',
): string {
  assertMinor(amount);
  const exponent = MINOR_UNIT_EXPONENT[currency];
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amount / 10 ** exponent);
}

/**
 * Parses a major-unit decimal string ("1234.56") into minor units.
 * String in, integer out — a `number` argument is refused precisely because
 * the caller would already have lost precision producing it.
 */
export function parseMinor(input: string, currency: CurrencyCode = 'USD'): Minor {
  const exponent = MINOR_UNIT_EXPONENT[currency];
  const trimmed = input.trim().replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new MoneyError(`"${input}" is not a valid decimal amount`);

  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > exponent) {
    throw new MoneyError(
      `"${input}" carries more precision than ${currency} supports (${exponent} decimals)`,
    );
  }
  const padded = fraction.padEnd(exponent, '0');
  const value = BigInt(whole) * BigInt(10 ** exponent) + BigInt(padded === '' ? '0' : padded);
  return toSafeNumber(sign === '-' ? -value : value, 'parsed amount');
}

/** Basis points → percentage string for display ("600" → "6%"). */
export function formatBasisPoints(rateBp: BasisPoints): string {
  assertBasisPoints(rateBp);
  const percent = rateBp / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, '')}%`;
}

/** Percentage string or number → basis points. "2.9" → 290. */
export function parseBasisPoints(input: string | number): BasisPoints {
  const text = typeof input === 'number' ? String(input) : input.trim().replace('%', '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new MoneyError(`"${input}" is not a valid percentage`);
  const [, whole = '0', fraction = ''] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0');
}
