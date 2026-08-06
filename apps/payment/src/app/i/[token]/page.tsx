import { brandThemeVariables } from '@fenwick/shared/tokens';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import { lookupInvoice } from '@/lib/invoice';
import { PaymentFlow } from './payment-flow';

// Never cached, never statically rendered: a balance is not a static value.
export const dynamic = 'force-dynamic';

const TERMINAL_STATUSES = new Set(['PAID', 'CANCELLED']);

/**
 * The public invoice page (TDD-001 §12.1). Card, ACH, processing, success,
 * pending and failure all work against FakeGateway; Numbers Gateway itself
 * remains blocked on DEP-01, and check upload and wallets are not built yet.
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
        <Shell>
          <p className="text-sm text-ink-muted">{invoice.brand.displayName}</p>
          <h1 className="mt-1 text-lg font-medium text-ink-strong">Invoice {invoice.number}</h1>
          <p className="mt-6 text-sm font-medium text-ink-strong">
            {invoice.status === 'PAID'
              ? 'This invoice has been paid.'
              : 'This invoice was cancelled.'}
          </p>
        </Shell>
      </div>
    );
  }

  return (
    <div style={theme as React.CSSProperties}>
      <Shell>
        <p className="text-sm text-ink-muted">{invoice.brand.displayName}</p>
        <h1 className="mt-1 text-lg font-medium text-ink-strong">Invoice {invoice.number}</h1>

        <dl className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Amount due</dt>
            <dd className="font-medium text-ink-strong">
              {formatMinorForDisplay(invoice.balanceMinor, toCurrencyCode(invoice.currency))}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Due</dt>
            <dd className="text-ink-strong">{invoice.dueDate}</dd>
          </div>
        </dl>

        <PaymentFlow invoice={invoice} token={token} />
      </Shell>
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm">{children}</div>
    </main>
  );
}
