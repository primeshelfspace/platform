import { brandThemeVariables } from '@fenwick/shared/tokens';
import { lookupInvoice } from '@/lib/invoice';
import { InvoiceDocument } from './invoice-document';

// Never cached, never statically rendered: a balance is not a static value.
export const dynamic = 'force-dynamic';

/**
 * The public invoice page — the invoice document alone (InvoiceDocument,
 * sized and laid out exactly like the admin's Invoice PDF preview), at
 * whatever status the invoice is actually in. No payment flow lives here
 * anymore (PaymentPageShell/PaymentFlow, removed at the user's request);
 * this is a view-only link, not a checkout page.
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

  return (
    <div className="min-h-full" style={theme as React.CSSProperties}>
      <InvoiceDocument invoice={invoice} />
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
 * (or ever will be) — InvoiceDocument needs a real invoice to lay out. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm">{children}</div>
    </main>
  );
}
