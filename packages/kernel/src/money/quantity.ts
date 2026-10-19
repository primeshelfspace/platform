/**
 * Quantity — fixed-point decimal with four places (TDD-001 §9.1).
 *
 * Stored and passed around as an integer count of ten-thousandths, so 1.5 is
 * 15000 and 0.3333 is 3333. Fractional units (hours, weight, partial licences)
 * are representable without a float ever entering the calculation.
 */

import { MoneyError } from './money.js';

/** An integer count of ten-thousandths of a unit. */
export type Quantity = number;

export const QUANTITY_SCALE = 10_000n;
export const QUANTITY_DECIMALS = 4;

export function assertQuantity(value: number, label = 'quantity'): Quantity {
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `${label} must be an integer count of ten-thousandths, received ${value}. ` +
        `Use quantityFrom("1.5") rather than passing 1.5 directly.`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range: ${value}`);
  }
  return value;
}

/** Parses a decimal string or whole number into scaled quantity units. */
export function quantityFrom(input: string | number): Quantity {
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) {
      throw new MoneyError(
        `pass fractional quantities as strings — quantityFrom("${input}") — so no precision is lost before parsing`,
      );
    }
    return input * Number(QUANTITY_SCALE);
  }

  const trimmed = input.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new MoneyError(`"${input}" is not a valid quantity`);

  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > QUANTITY_DECIMALS) {
    throw new MoneyError(
      `"${input}" carries more than ${QUANTITY_DECIMALS} decimal places of quantity precision`,
    );
  }
  const padded = fraction.padEnd(QUANTITY_DECIMALS, '0');
  const value = BigInt(whole) * QUANTITY_SCALE + BigInt(padded === '' ? '0' : padded);
  const signed = sign === '-' ? -value : value;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`quantity "${input}" overflows the safe integer range`);
  }
  return Number(signed);
}

/** Scaled quantity → decimal string with trailing zeroes trimmed. */
export function formatQuantity(quantity: Quantity): string {
  assertQuantity(quantity);
  const negative = quantity < 0;
  const magnitude = Math.abs(quantity);
  const whole = Math.trunc(magnitude / Number(QUANTITY_SCALE));
  const fraction = String(magnitude % Number(QUANTITY_SCALE))
    .padStart(QUANTITY_DECIMALS, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
