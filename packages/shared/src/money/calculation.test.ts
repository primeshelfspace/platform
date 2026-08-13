import { describe, expect, it } from 'vitest';
import { calculate, calculateLineTotal, incursCardFee, quoteForMethod } from './calculation.js';
import { MoneyError, formatMinor, parseMinor } from './money.js';
import { quantityFrom } from './quantity.js';

/**
 * TDD-001 §9.3 — the worked example, required verbatim as a fixture and the
 * basis of the FR-TAX acceptance criteria.
 *
 * SPEC GAP, RAISED FOR CONFIRMATION
 * The document writes line 2 as "6 × 118.375". A unit price of 118.375 needs
 * three decimal places, which `invoice.unit_price_minor` (integer minor units,
 * TDD-001 §5.2) cannot hold. Quantity is the field specified as fixed-point
 * with four places, so the fixture is encoded with the fraction on the quantity
 * side — 118.375 units at $6.00 — which is arithmetically identical and yields
 * the document's 710.25 exactly.
 *
 * If the client's real requirement is fractional UNIT PRICES, the schema needs
 * a 4-decimal price column and this fixture changes. That is a question for the
 * client, not a decision to make silently here.
 */
const WORKED_EXAMPLE = {
  lines: [
    // Line 1: 12 × 200.00 = 2,400.00
    { quantity: quantityFrom(12), unitPriceMinor: parseMinor('200.00') },
    // Line 2: 118.375 × 6.00 = 710.25  (document states "6 × 118.375")
    { quantity: quantityFrom('118.375'), unitPriceMinor: parseMinor('6.00') },
  ],
  taxRateBp: 600, // 6%
  cardFeeRateBp: 290, // 2.9%
} as const;

describe('TDD-001 §9.3 worked example', () => {
  it('produces the documented figures for a card payment', () => {
    const result = calculate({ ...WORKED_EXAMPLE, paymentMethod: 'CARD' });

    expect(formatMinor(result.lines[0]!.lineTotalMinor)).toBe('2400.00');
    expect(formatMinor(result.lines[1]!.lineTotalMinor)).toBe('710.25');
    expect(formatMinor(result.subtotalMinor)).toBe('3110.25');
    expect(formatMinor(result.taxMinor)).toBe('186.62');
    expect(formatMinor(result.preFeeTotalMinor)).toBe('3296.87');
    expect(formatMinor(result.cardFeeMinor)).toBe('95.61');
    expect(formatMinor(result.totalMinor)).toBe('3392.48');
  });

  it('produces the documented figures for an ACH payment, with no fee', () => {
    const result = calculate({ ...WORKED_EXAMPLE, paymentMethod: 'ACH' });

    expect(formatMinor(result.subtotalMinor)).toBe('3110.25');
    expect(formatMinor(result.taxMinor)).toBe('186.62');
    expect(result.cardFeeApplied).toBe(false);
    expect(result.cardFeeMinor).toBe(0);
    expect(formatMinor(result.totalMinor)).toBe('3296.87');
  });

  it('rounds tax half-up: 18661.5 ten-thousandths becomes 186.62, not 186.61', () => {
    const result = calculate({ ...WORKED_EXAMPLE, paymentMethod: 'ACH' });
    // 311025 × 600 / 10000 = 18661.5 exactly — the tie case.
    expect(result.taxMinor).toBe(18662);
  });

  it('quotes both methods from one input', () => {
    const card = quoteForMethod(WORKED_EXAMPLE, 'CARD');
    const ach = quoteForMethod(WORKED_EXAMPLE, 'ACH');
    expect(card.totalMinor - ach.totalMinor).toBe(9561);
  });
});

describe('card fee eligibility', () => {
  it('applies to card and wallet only', () => {
    expect(incursCardFee('CARD')).toBe(true);
    expect(incursCardFee('WALLET')).toBe(true);
    expect(incursCardFee('ACH')).toBe(false);
    expect(incursCardFee('CHECK')).toBe(false);
    expect(incursCardFee('MANUAL')).toBe(false);
  });
});

describe('tax-exempt lines', () => {
  it('excludes exempt lines from the taxable base but not the subtotal', () => {
    const result = calculate({
      lines: [
        { quantity: quantityFrom(1), unitPriceMinor: parseMinor('100.00') },
        { quantity: quantityFrom(1), unitPriceMinor: parseMinor('50.00'), taxExempt: true },
      ],
      taxRateBp: 1000, // 10%
      cardFeeRateBp: 0,
      paymentMethod: 'ACH',
    });

    expect(result.subtotalMinor).toBe(15000);
    expect(result.taxableBaseMinor).toBe(10000);
    expect(result.taxMinor).toBe(1000);
    expect(result.totalMinor).toBe(16000);
  });

  it('charges no tax when every line is exempt', () => {
    const result = calculate({
      lines: [{ quantity: quantityFrom(3), unitPriceMinor: 999, taxExempt: true }],
      taxRateBp: 875,
      cardFeeRateBp: 290,
      paymentMethod: 'CARD',
    });
    expect(result.taxMinor).toBe(0);
    expect(result.subtotalMinor).toBe(2997);
  });
});

describe('line total rounding (round 1)', () => {
  it('rounds fractional quantities half away from zero', () => {
    // 0.3333 × 100 minor = 33.33 → 33
    expect(calculateLineTotal(quantityFrom('0.3333'), 100)).toBe(33);
    // 0.005 × 100 minor = 0.5 → 1  (tie, away from zero)
    expect(calculateLineTotal(quantityFrom('0.005'), 100)).toBe(1);
    // negative tie rounds to the same magnitude
    expect(calculateLineTotal(quantityFrom('-0.005'), 100)).toBe(-1);
  });

  it('handles a zero quantity', () => {
    expect(calculateLineTotal(quantityFrom(0), 12345)).toBe(0);
  });

  it('refuses a non-integer unit price', () => {
    expect(() => calculateLineTotal(quantityFrom(1), 10.5)).toThrow(MoneyError);
  });

  it('refuses a line total that overflows the safe integer range', () => {
    // Each input is individually a safe integer; only their product is not.
    expect(() => calculateLineTotal(quantityFrom(2), Number.MAX_SAFE_INTEGER)).toThrow(
      /line total overflows the safe integer range/,
    );
  });
});

describe('balance', () => {
  it('subtracts settled payments from the total', () => {
    const result = calculate({
      lines: [{ quantity: quantityFrom(1), unitPriceMinor: 10000 }],
      taxRateBp: 0,
      cardFeeRateBp: 0,
      paymentMethod: 'ACH',
      settledMinor: 4000,
    });
    expect(result.balanceMinor).toBe(6000);
  });

  it('goes negative on overpayment rather than clamping', () => {
    const result = calculate({
      lines: [{ quantity: quantityFrom(1), unitPriceMinor: 10000 }],
      taxRateBp: 0,
      cardFeeRateBp: 0,
      paymentMethod: 'ACH',
      settledMinor: 12000,
    });
    // Overpayment is a real condition that needs handling upstream, not a
    // number to hide by flooring at zero.
    expect(result.balanceMinor).toBe(-2000);
  });
});

describe('subtotal overflow', () => {
  it('refuses a subtotal that overflows the safe integer range even though every line is individually safe', () => {
    const line = { quantity: quantityFrom(1), unitPriceMinor: Number.MAX_SAFE_INTEGER };
    expect(() =>
      calculate({
        lines: [line, line],
        taxRateBp: 0,
        cardFeeRateBp: 0,
        paymentMethod: 'ACH',
      }),
    ).toThrow(/sum overflows the safe integer range/);
  });
});

describe('empty invoice', () => {
  it('calculates zero throughout', () => {
    const result = calculate({
      lines: [],
      taxRateBp: 600,
      cardFeeRateBp: 290,
      paymentMethod: 'CARD',
    });
    expect(result.subtotalMinor).toBe(0);
    expect(result.taxMinor).toBe(0);
    expect(result.cardFeeMinor).toBe(0);
    expect(result.totalMinor).toBe(0);
  });
});

describe('rate validation', () => {
  it('refuses a negative tax rate', () => {
    expect(() =>
      calculate({ lines: [], taxRateBp: -1, cardFeeRateBp: 0, paymentMethod: 'ACH' }),
    ).toThrow(MoneyError);
  });

  it('refuses a fractional basis point', () => {
    expect(() =>
      calculate({ lines: [], taxRateBp: 600.5, cardFeeRateBp: 0, paymentMethod: 'ACH' }),
    ).toThrow(MoneyError);
  });
});
