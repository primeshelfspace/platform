/**
 * Invoice state machine (TDD-001 §8.1 and §8.2).
 *
 * Overdue is deliberately NOT a status. It is an overlay flag applied by a
 * scheduled job when the due date passes with a positive balance, so that an
 * overdue invoice keeps whatever lifecycle state it was actually in.
 *
 * Pure: the guards take a context object and return a decision. Persistence,
 * audit and side effects belong to InvoiceService, not here.
 */

export const INVOICE_STATUSES = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'PENDING_PAYMENT',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
  'PAID',
  'CANCELLED',
]);

/** Statuses in which the public payment page will accept a payment attempt. */
export const PAYABLE_STATUSES: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
  'SENT',
  'VIEWED',
  'PENDING_PAYMENT',
  'PARTIALLY_PAID',
]);

export const INVOICE_TRANSITIONS = [
  'ISSUE',
  'FIRST_VIEW',
  'INITIATE_PAYMENT',
  'SETTLE_PARTIAL',
  'SETTLE_FULL',
  'PAYMENT_FAILED',
  'CANCEL',
] as const;
export type InvoiceTransition = (typeof INVOICE_TRANSITIONS)[number];

const ALLOWED: Record<InvoiceTransition, ReadonlySet<InvoiceStatus>> = {
  ISSUE: new Set<InvoiceStatus>(['DRAFT']),
  FIRST_VIEW: new Set<InvoiceStatus>(['SENT']),
  // PENDING_PAYMENT is included so a customer who abandons a card form (or
  // simply reloads the page) can start a fresh attempt instead of being
  // permanently stuck — the ALREADY_SETTLED guard below still refuses this
  // once the balance actually clears, and a second concurrent attempt
  // settling can never double-pay: SETTLE_FULL/PARTIAL are not reachable
  // from PAID, so whichever attempt settles first wins and the other is
  // refused at the transition level, not merely by convention.
  INITIATE_PAYMENT: new Set<InvoiceStatus>(['SENT', 'VIEWED', 'PARTIALLY_PAID', 'PENDING_PAYMENT']),
  SETTLE_PARTIAL: new Set<InvoiceStatus>(['PENDING_PAYMENT', 'PARTIALLY_PAID']),
  SETTLE_FULL: new Set<InvoiceStatus>(['PENDING_PAYMENT', 'PARTIALLY_PAID']),
  PAYMENT_FAILED: new Set<InvoiceStatus>(['PENDING_PAYMENT']),
  CANCEL: new Set<InvoiceStatus>(['DRAFT', 'SENT', 'VIEWED', 'PENDING_PAYMENT']),
};

export interface TransitionContext {
  readonly status: InvoiceStatus;
  /** Set on PAYMENT_FAILED: the state to return to. */
  readonly previousStatus?: InvoiceStatus | null;
  readonly lineItemCount: number;
  readonly totalMinor: number;
  readonly balanceMinor: number;
  readonly settledMinor: number;
  readonly customerHasDeliverableEmail: boolean;
}

export type TransitionResult =
  | { readonly ok: true; readonly to: InvoiceStatus }
  | { readonly ok: false; readonly code: TransitionFailure; readonly message: string };

export type TransitionFailure =
  | 'ILLEGAL_FROM_STATUS'
  | 'NO_LINE_ITEMS'
  | 'NON_POSITIVE_TOTAL'
  | 'NO_DELIVERABLE_EMAIL'
  | 'ALREADY_SETTLED'
  | 'BALANCE_NOT_CLEARED'
  | 'BALANCE_ALREADY_CLEARED'
  | 'SETTLED_PAYMENT_EXISTS'
  | 'NO_PREVIOUS_STATUS';

/**
 * Evaluates a transition and returns either the resulting status or the reason
 * it is refused. Never throws — the caller decides whether a refusal is a 409,
 * a 422 or a discarded webhook.
 */
export function evaluateTransition(
  transition: InvoiceTransition,
  context: TransitionContext,
): TransitionResult {
  if (!ALLOWED[transition].has(context.status)) {
    return refuse('ILLEGAL_FROM_STATUS', `${transition} is not permitted from ${context.status}`);
  }

  switch (transition) {
    case 'ISSUE': {
      if (context.lineItemCount < 1) {
        return refuse('NO_LINE_ITEMS', 'an invoice must carry at least one line item to issue');
      }
      if (context.totalMinor <= 0) {
        return refuse('NON_POSITIVE_TOTAL', 'invoice total must be positive to issue');
      }
      if (!context.customerHasDeliverableEmail) {
        return refuse('NO_DELIVERABLE_EMAIL', 'the customer has no deliverable email address');
      }
      return { ok: true, to: 'SENT' };
    }

    case 'FIRST_VIEW':
      // Only the first retrieval fires; the SENT-only guard above enforces it.
      return { ok: true, to: 'VIEWED' };

    case 'INITIATE_PAYMENT': {
      if (context.balanceMinor <= 0) {
        return refuse('ALREADY_SETTLED', 'the invoice balance is already cleared');
      }
      return { ok: true, to: 'PENDING_PAYMENT' };
    }

    case 'SETTLE_PARTIAL': {
      if (context.settledMinor <= 0) {
        return refuse('BALANCE_NOT_CLEARED', 'a partial settlement must be a positive amount');
      }
      if (context.settledMinor >= context.totalMinor) {
        return refuse(
          'BALANCE_ALREADY_CLEARED',
          'cumulative settlement clears the invoice — use SETTLE_FULL',
        );
      }
      return { ok: true, to: 'PARTIALLY_PAID' };
    }

    case 'SETTLE_FULL': {
      if (context.settledMinor < context.totalMinor) {
        return refuse(
          'BALANCE_NOT_CLEARED',
          'cumulative settlement does not cover the total — use SETTLE_PARTIAL',
        );
      }
      return { ok: true, to: 'PAID' };
    }

    case 'PAYMENT_FAILED': {
      const previous = context.previousStatus;
      if (!previous || previous === 'PENDING_PAYMENT') {
        return refuse('NO_PREVIOUS_STATUS', 'no prior status recorded to return to');
      }
      return { ok: true, to: previous };
    }

    case 'CANCEL': {
      if (context.settledMinor > 0) {
        return refuse(
          'SETTLED_PAYMENT_EXISTS',
          'an invoice with a settled payment cannot be cancelled',
        );
      }
      return { ok: true, to: 'CANCELLED' };
    }
  }
}

function refuse(code: TransitionFailure, message: string): TransitionResult {
  return { ok: false, code, message };
}

/** The overdue overlay (TDD-001 §8.1). Not a status. */
export function isOverdue(input: {
  readonly status: InvoiceStatus;
  readonly dueDate: Date;
  readonly balanceMinor: number;
  readonly asOf: Date;
}): boolean {
  if (input.status === 'PAID' || input.status === 'CANCELLED') return false;
  if (input.status === 'DRAFT') return false;
  return input.balanceMinor > 0 && input.asOf.getTime() > input.dueDate.getTime();
}

export function isTerminal(status: InvoiceStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isPayable(status: InvoiceStatus): boolean {
  return PAYABLE_STATUSES.has(status);
}

/**
 * Customer-facing copy for a settled invoice — shown on the public payment
 * page in place of a payment form, and mirrored by the admin app's own
 * preview of that same page. Null for anything not terminal, so callers can
 * use it as both the message and the terminal check in one call.
 */
export function terminalStatusLabel(status: InvoiceStatus): string | null {
  if (status === 'PAID') return 'This invoice has been paid.';
  if (status === 'CANCELLED') return 'This invoice was cancelled.';
  return null;
}
