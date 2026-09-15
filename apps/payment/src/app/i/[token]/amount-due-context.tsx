'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface AmountDueValue {
  amountMinor: number;
  setAmountMinor: (amountMinor: number) => void;
}

const AmountDueContext = createContext<AmountDueValue | null>(null);

/**
 * Keeps the invoice summary's headline amount (PaymentPageShell's
 * InvoiceSummary) and the payment form's "Pay {amount}" button in lockstep.
 * PaymentForm quotes a higher total for methods that carry a card fee
 * (TDD-001 §9.2) — without this, the summary at the top of the page kept
 * showing the invoice's plain balance while the button below charged more,
 * which reads as the page being wrong even though both numbers were each
 * individually correct for what they represented.
 */
export function AmountDueProvider({
  initialMinor,
  children,
}: {
  initialMinor: number;
  children: ReactNode;
}) {
  const [amountMinor, setAmountMinor] = useState(initialMinor);
  return (
    <AmountDueContext.Provider value={{ amountMinor, setAmountMinor }}>
      {children}
    </AmountDueContext.Provider>
  );
}

/** Null outside a provider — the settled/non-payable states render no
 * PaymentForm and nothing wraps this in a provider there, so callers fall
 * back to the invoice's own balance in that case. */
export function useAmountDue(): AmountDueValue | null {
  return useContext(AmountDueContext);
}
