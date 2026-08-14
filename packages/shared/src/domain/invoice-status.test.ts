import { describe, expect, it } from 'vitest';
import {
  type TransitionContext,
  evaluateTransition,
  isOverdue,
  isPayable,
  isTerminal,
  terminalStatusLabel,
} from './invoice-status.js';

const base: TransitionContext = {
  status: 'DRAFT',
  previousStatus: null,
  lineItemCount: 2,
  totalMinor: 339248,
  balanceMinor: 339248,
  settledMinor: 0,
  customerHasDeliverableEmail: true,
};

describe('ISSUE', () => {
  it('moves a complete draft to SENT', () => {
    expect(evaluateTransition('ISSUE', base)).toEqual({ ok: true, to: 'SENT' });
  });

  it('refuses an invoice with no line items', () => {
    const result = evaluateTransition('ISSUE', { ...base, lineItemCount: 0 });
    expect(result).toMatchObject({ ok: false, code: 'NO_LINE_ITEMS' });
  });

  it('refuses a non-positive total', () => {
    expect(evaluateTransition('ISSUE', { ...base, totalMinor: 0 })).toMatchObject({
      ok: false,
      code: 'NON_POSITIVE_TOTAL',
    });
  });

  it('refuses a customer with no deliverable email', () => {
    expect(
      evaluateTransition('ISSUE', { ...base, customerHasDeliverableEmail: false }),
    ).toMatchObject({ ok: false, code: 'NO_DELIVERABLE_EMAIL' });
  });

  it('refuses to issue anything that is not a draft', () => {
    expect(evaluateTransition('ISSUE', { ...base, status: 'SENT' })).toMatchObject({
      ok: false,
      code: 'ILLEGAL_FROM_STATUS',
    });
  });
});

describe('FIRST_VIEW', () => {
  it('fires once, from SENT only', () => {
    expect(evaluateTransition('FIRST_VIEW', { ...base, status: 'SENT' })).toEqual({
      ok: true,
      to: 'VIEWED',
    });
    expect(evaluateTransition('FIRST_VIEW', { ...base, status: 'VIEWED' })).toMatchObject({
      ok: false,
      code: 'ILLEGAL_FROM_STATUS',
    });
  });
});

describe('INITIATE_PAYMENT', () => {
  it('is allowed from SENT, VIEWED, PARTIALLY_PAID, and PENDING_PAYMENT', () => {
    // PENDING_PAYMENT is included so an abandoned or reloaded attempt can
    // always be retried, not just the first one — see the ALLOWED comment.
    for (const status of ['SENT', 'VIEWED', 'PARTIALLY_PAID', 'PENDING_PAYMENT'] as const) {
      expect(evaluateTransition('INITIATE_PAYMENT', { ...base, status })).toEqual({
        ok: true,
        to: 'PENDING_PAYMENT',
      });
    }
  });

  it('refuses when the balance is already cleared', () => {
    expect(
      evaluateTransition('INITIATE_PAYMENT', { ...base, status: 'VIEWED', balanceMinor: 0 }),
    ).toMatchObject({ ok: false, code: 'ALREADY_SETTLED' });
  });

  it('refuses from DRAFT', () => {
    expect(evaluateTransition('INITIATE_PAYMENT', base)).toMatchObject({
      ok: false,
      code: 'ILLEGAL_FROM_STATUS',
    });
  });
});

describe('settlement', () => {
  const pending = { ...base, status: 'PENDING_PAYMENT' } as const;

  it('moves to PARTIALLY_PAID when settlement is short of the total', () => {
    expect(evaluateTransition('SETTLE_PARTIAL', { ...pending, settledMinor: 100000 })).toEqual({
      ok: true,
      to: 'PARTIALLY_PAID',
    });
  });

  it('directs a full settlement away from SETTLE_PARTIAL', () => {
    expect(
      evaluateTransition('SETTLE_PARTIAL', { ...pending, settledMinor: pending.totalMinor }),
    ).toMatchObject({ ok: false, code: 'BALANCE_ALREADY_CLEARED' });
  });

  it('moves to PAID when cumulative settlement covers the total', () => {
    expect(
      evaluateTransition('SETTLE_FULL', { ...pending, settledMinor: pending.totalMinor }),
    ).toEqual({ ok: true, to: 'PAID' });
  });

  it('treats overpayment as full settlement', () => {
    expect(
      evaluateTransition('SETTLE_FULL', { ...pending, settledMinor: pending.totalMinor + 1 }),
    ).toEqual({ ok: true, to: 'PAID' });
  });

  it('refuses SETTLE_FULL when the balance is not covered', () => {
    expect(evaluateTransition('SETTLE_FULL', { ...pending, settledMinor: 1 })).toMatchObject({
      ok: false,
      code: 'BALANCE_NOT_CLEARED',
    });
  });

  it('refuses a zero partial settlement', () => {
    expect(evaluateTransition('SETTLE_PARTIAL', { ...pending, settledMinor: 0 })).toMatchObject({
      ok: false,
      code: 'BALANCE_NOT_CLEARED',
    });
  });
});

describe('PAYMENT_FAILED', () => {
  it('returns the invoice to its prior state', () => {
    expect(
      evaluateTransition('PAYMENT_FAILED', {
        ...base,
        status: 'PENDING_PAYMENT',
        previousStatus: 'VIEWED',
      }),
    ).toEqual({ ok: true, to: 'VIEWED' });
  });

  it('refuses when no prior state was recorded', () => {
    expect(
      evaluateTransition('PAYMENT_FAILED', { ...base, status: 'PENDING_PAYMENT' }),
    ).toMatchObject({ ok: false, code: 'NO_PREVIOUS_STATUS' });
  });
});

describe('CANCEL', () => {
  it('is allowed from every pre-payment state', () => {
    for (const status of ['DRAFT', 'SENT', 'VIEWED', 'PENDING_PAYMENT'] as const) {
      expect(evaluateTransition('CANCEL', { ...base, status })).toEqual({
        ok: true,
        to: 'CANCELLED',
      });
    }
  });

  it('refuses once any payment has settled', () => {
    expect(
      evaluateTransition('CANCEL', { ...base, status: 'SENT', settledMinor: 1 }),
    ).toMatchObject({ ok: false, code: 'SETTLED_PAYMENT_EXISTS' });
  });

  it('refuses from PAID and PARTIALLY_PAID', () => {
    for (const status of ['PAID', 'PARTIALLY_PAID', 'CANCELLED'] as const) {
      expect(evaluateTransition('CANCEL', { ...base, status })).toMatchObject({
        ok: false,
        code: 'ILLEGAL_FROM_STATUS',
      });
    }
  });
});

describe('overdue overlay', () => {
  const dueDate = new Date('2026-07-01T00:00:00Z');

  it('flags a past-due invoice with a positive balance', () => {
    expect(
      isOverdue({
        status: 'SENT',
        dueDate,
        balanceMinor: 100,
        asOf: new Date('2026-07-02T00:00:00Z'),
      }),
    ).toBe(true);
  });

  it('does not flag paid, cancelled or draft invoices', () => {
    for (const status of ['PAID', 'CANCELLED', 'DRAFT'] as const) {
      expect(
        isOverdue({ status, dueDate, balanceMinor: 100, asOf: new Date('2026-07-02T00:00:00Z') }),
      ).toBe(false);
    }
  });

  it('does not flag a cleared balance', () => {
    expect(
      isOverdue({
        status: 'PARTIALLY_PAID',
        dueDate,
        balanceMinor: 0,
        asOf: new Date('2026-07-02T00:00:00Z'),
      }),
    ).toBe(false);
  });

  it('does not flag before the due date passes', () => {
    expect(
      isOverdue({
        status: 'SENT',
        dueDate,
        balanceMinor: 100,
        asOf: new Date('2026-06-30T00:00:00Z'),
      }),
    ).toBe(false);
  });
});

describe('status predicates', () => {
  it('identifies terminal and payable states', () => {
    expect(isTerminal('PAID')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('SENT')).toBe(false);
    expect(isPayable('DRAFT')).toBe(false);
    expect(isPayable('PARTIALLY_PAID')).toBe(true);
  });
});

describe('terminalStatusLabel', () => {
  it('describes each terminal status', () => {
    expect(terminalStatusLabel('PAID')).toBe('This invoice has been paid.');
    expect(terminalStatusLabel('CANCELLED')).toBe('This invoice was cancelled.');
  });

  it('is null for anything not terminal', () => {
    for (const status of [
      'DRAFT',
      'SENT',
      'VIEWED',
      'PENDING_PAYMENT',
      'PARTIALLY_PAID',
    ] as const) {
      expect(terminalStatusLabel(status)).toBeNull();
    }
  });
});
