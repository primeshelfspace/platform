/**
 * CalculationService — subtotal, tax, card fee and total (TDD-001 §9.2).
 *
 * Pure by construction: it takes line items, rates and a payment method, and
 * returns a breakdown. No I/O, no state, no framework types. This is the single
 * code path behind the figure shown on the invoice, in the PDF, on the payment
 * page and in the Zoho push, which is what stops two surfaces disagreeing about
 * a total.
 *
 * Rounding happens at exactly three points, marked below. Never intermediately.
 */

import {
  type BasisPoints,
  type Minor,
  applyBasisPoints,
  assertBasisPoints,
  assertMinor,
  divideRoundHalfUp,
} from './money.js';
import { QUANTITY_SCALE, type Quantity, assertQuantity } from './quantity.js';

/** Payment methods, and whether each attracts the card fee. */
export const PAYMENT_METHODS = ['CARD', 'WALLET', 'ACH', 'CHECK', 'MANUAL'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** TDD-001 §9.2: the fee applies to card and wallet only. */
const FEE_BEARING_METHODS: ReadonlySet<PaymentMethod> = new Set<PaymentMethod>(['CARD', 'WALLET']);

export function incursCardFee(method: PaymentMethod): boolean {
  return FEE_BEARING_METHODS.has(method);
}

export interface CalculationLineInput {
  /** Scaled by 10,000 — see quantity.ts. */
  readonly quantity: Quantity;
  /** Integer minor units. */
  readonly unitPriceMinor: Minor;
  /** Excluded from the taxable base when true. */
  readonly taxExempt?: boolean;
}

export interface CalculationInput {
  readonly lines: readonly CalculationLineInput[];
  /** Tax rate in basis points, frozen at issue (NFR-INT-004). */
  readonly taxRateBp: BasisPoints;
  /** Card fee rate in basis points, frozen at issue. */
  readonly cardFeeRateBp: BasisPoints;
  /** Determines whether the card fee applies at all. */
  readonly paymentMethod: PaymentMethod;
  /** Settled payments already recorded against the invoice. */
  readonly settledMinor?: Minor;
}

export interface CalculationLineResult {
  readonly lineTotalMinor: Minor;
  readonly taxExempt: boolean;
}

export interface CalculationResult {
  readonly lines: readonly CalculationLineResult[];
  readonly subtotalMinor: Minor;
  readonly taxableBaseMinor: Minor;
  readonly taxRateBpApplied: BasisPoints;
  readonly taxMinor: Minor;
  readonly preFeeTotalMinor: Minor;
  readonly cardFeeRateBpApplied: BasisPoints;
  readonly cardFeeMinor: Minor;
  readonly cardFeeApplied: boolean;
  readonly totalMinor: Minor;
  readonly settledMinor: Minor;
  readonly balanceMinor: Minor;
}

/**
 * Line total, rounded once (round 1 of 3).
 *
 * quantity is scaled by 10,000, so the division by that scale is where the
 * fractional part is resolved.
 */
export function calculateLineTotal(quantity: Quantity, unitPriceMinor: Minor): Minor {
  assertQuantity(quantity);
  assertMinor(unitPriceMinor, 'unit price');
  const product = BigInt(quantity) * BigInt(unitPriceMinor);
  const rounded = divideRoundHalfUp(product, QUANTITY_SCALE);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER) || rounded < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`line total overflows the safe integer range: ${rounded}`);
  }
  return Number(rounded);
}

/** The whole calculation, in the order fixed by TDD-001 §9.2. */
export function calculate(input: CalculationInput): CalculationResult {
  const taxRateBp = assertBasisPoints(input.taxRateBp, 'tax rate');
  const cardFeeRateBp = assertBasisPoints(input.cardFeeRateBp, 'card fee rate');
  const settledMinor = assertMinor(input.settledMinor ?? 0, 'settled amount');

  const lines: CalculationLineResult[] = input.lines.map((line) => ({
    // ── round 1 ──────────────────────────────────────────────────────────
    lineTotalMinor: calculateLineTotal(line.quantity, line.unitPriceMinor),
    taxExempt: line.taxExempt === true,
  }));

  const subtotalMinor = sum(lines.map((l) => l.lineTotalMinor));
  const taxableBaseMinor = sum(lines.filter((l) => !l.taxExempt).map((l) => l.lineTotalMinor));

  // ── round 2 ────────────────────────────────────────────────────────────
  const taxMinor = applyBasisPoints(taxableBaseMinor, taxRateBp);

  const preFeeTotalMinor = subtotalMinor + taxMinor;

  // ── round 3 ────────────────────────────────────────────────────────────
  //
  // OPEN QUESTION Q-01 (FRS-001): the fee is computed on the POST-TAX total.
  // If the client intends the pre-tax subtotal instead, change the argument
  // below and every downstream figure moves with it. Surcharging is also
  // regulated in some US states — confirm before this ships.
  const cardFeeApplied = incursCardFee(input.paymentMethod);
  const cardFeeMinor = cardFeeApplied ? applyBasisPoints(preFeeTotalMinor, cardFeeRateBp) : 0;

  const totalMinor = preFeeTotalMinor + cardFeeMinor;
  const balanceMinor = totalMinor - settledMinor;

  return {
    lines,
    subtotalMinor,
    taxableBaseMinor,
    taxRateBpApplied: taxRateBp,
    taxMinor,
    preFeeTotalMinor,
    cardFeeRateBpApplied: cardFeeRateBp,
    cardFeeMinor,
    cardFeeApplied,
    totalMinor,
    settledMinor,
    balanceMinor,
  };
}

/**
 * The amount a customer sees for a given payment method, without recomputing
 * the invoice. The payment page calls this to show "pay by ACH and save the
 * card fee" without a round trip.
 */
export function quoteForMethod(
  input: Omit<CalculationInput, 'paymentMethod'>,
  method: PaymentMethod,
): CalculationResult {
  return calculate({ ...input, paymentMethod: method });
}

function sum(values: readonly Minor[]): Minor {
  const total = values.reduce<bigint>((acc, v) => acc + BigInt(assertMinor(v)), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`sum overflows the safe integer range: ${total}`);
  }
  return Number(total);
}
