import { brandThemeVariables } from '@fenwick/shared/tokens';
import { lookupInvoice } from '@/lib/invoice';
import { PaymentFlow } from './payment-flow';
import { PaymentPageShell } from './payment-page-shell';

// Never cached, never statically rendered: a balance is not a static value.
export const dynamic = 'force-dynamic';

const TERMINAL_STATUSES = new Set(['PAID', 'CANCELLED']);

/**
 * The public invoice page (TDD-001 §12.1). Card, ACH, processing, success,
 * pending and failure all work against FakeGateway; Numbers Gateway itself
 * remains blocked on DEP-01, and check upload and wallets are not built yet.
 *
 * Brand chrome (PaymentPageShell) renders whichever of Banner/Centered/Split
 * this brand picked in Brand Settings > Branding > Payment Page — the same
 * setting the admin editor previews, actually applied here.
 */
export default async function InvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await lookupInvoice(token);

  if (result.state === 'not-found') return <Terminal />;

  if (result.state === 'unavailable') {
    return (
      <Shell>
        <h1 className="text-lg font-medium text-ink-strong">We can&rsquo;t load this invoice</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Something on our side is not responding. Your link is still valid — please try again in a
          few minutes.
        </p>
        <p className="mt-4 font-mono text-xs text-ink-subtle">{result.detail}</p>
      </Shell>
    );
  }

  const { invoice } = result;
  const theme = brandThemeVariables(invoice.brand.themeColor);

  // FR-PAY-014: an invoice that is already settled or void gets the same
  // terminal treatment as an unknown token — no payment form, ever.
  if (TERMINAL_STATUSES.has(invoice.status)) {
    return (
      <div style={theme as React.CSSProperties}>
        <PaymentPageShell invoice={invoice}>
          <p className="text-center text-sm font-medium text-ink-strong">
            {invoice.status === 'PAID'
              ? 'This invoice has been paid.'
              : 'This invoice was cancelled.'}
          </p>
        </PaymentPageShell>
      </div>
    );
  }

  return (
    <div style={theme as React.CSSProperties}>
      <PaymentPageShell invoice={invoice}>
        <PaymentFlow invoice={invoice} token={token} />
      </PaymentPageShell>
    </div>
  );
}

/**
 * One terminal page for every "this link does not resolve" case. It names no
 * brand and no invoice, so it cannot be used to confirm that either exists.
 */
function Terminal() {
  return (
    <Shell>
      <h1 className="text-lg font-medium text-ink-strong">This payment link is no longer valid</h1>
      <p className="mt-2 text-sm text-ink-muted">
        The link may have expired, or the invoice may already have been paid or cancelled. If you
        think this is a mistake, reply to the email the invoice came from.
      </p>
    </Shell>
  );
}

/** Unbranded fallback for the two states above where no brand is known yet
 * (or ever will be) — PaymentPageShell needs a real invoice to lay out. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm">{children}</div>
    </main>
  );
}
