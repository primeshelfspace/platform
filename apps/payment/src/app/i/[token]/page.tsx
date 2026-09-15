import { isPayable, terminalStatusLabel } from '@fenwick/shared';
import { brandThemeVariables } from '@fenwick/shared/tokens';
import { lookupInvoice } from '@/lib/invoice';
import { AmountDueProvider } from './amount-due-context';
import { PaymentPageShell } from './payment-page-shell';
import { PaymentForm } from './payment-form';
import { Terminal, Unavailable } from './states';

// Never cached, never statically rendered: a balance is not a static value.
export const dynamic = 'force-dynamic';

/**
 * The hosted payment page — where the "View & Pay Invoice" button in an
 * invoice email actually lands (the API builds that link as
 * `{PAYMENT_PUBLIC_URL}/i/{publicToken}`; see InvoicesService.send).
 *
 * Brand chrome comes from Brand Settings > Branding > Payment Page, so this
 * renders as the layout and accent colour the merchant configured and
 * previewed there. The invoice document itself is not here: it lives one
 * level down at /i/{token}/invoice, behind this page's "Download invoice"
 * action.
 */
export default async function PaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  /** ?method=CARD|WALLET|ACH|CHECK — set when the sender picked a preferred
   * method in the Send Invoice compose modal. Advisory only: PaymentForm
   * ignores it for any method this brand has not actually enabled. */
  searchParams: Promise<{ method?: string }>;
}) {
  const { token } = await params;
  const { method } = await searchParams;
  const result = await lookupInvoice(token);

  if (result.state === 'not-found') return <Terminal />;
  if (result.state === 'unavailable') return <Unavailable detail={result.detail} />;

  const { invoice } = result;
  const theme = brandThemeVariables(invoice.brand.themeColor);

  // A settled or otherwise unpayable invoice keeps the whole branded page —
  // the customer still needs the numbers and the invoice download — and gets
  // a plain statement where the form would be. The admin editor previews the
  // same substitution (SettledNotice), and PaymentsService rejects an attempt
  // on these statuses server-side regardless of what renders here.
  const settledLabel = terminalStatusLabel(invoice.status);

  return (
    <div className="h-full" style={theme as React.CSSProperties}>
      <AmountDueProvider initialMinor={invoice.balanceMinor}>
        <PaymentPageShell invoice={invoice} token={token}>
          {settledLabel ? (
            <Notice>{settledLabel}</Notice>
          ) : isPayable(invoice.status) ? (
            <PaymentForm invoice={invoice} token={token} preferredMethod={method} />
          ) : (
            <Notice>This invoice is not open for payment yet.</Notice>
          )}
        </PaymentPageShell>
      </AmountDueProvider>
    </div>
  );
}

/** What the page shows in place of a payment form. Same block, same box —
 * mirrors SettledNotice in the admin's Payment Page editor. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-[#E5E7EB] bg-surface-muted px-4 py-6 text-center text-sm font-medium text-ink-strong">
      {children}
    </p>
  );
}
