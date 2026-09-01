import { brandThemeVariables } from '@fenwick/shared/tokens';
import { lookupInvoice } from '@/lib/invoice';
import { InvoiceDocument } from '../invoice-document';
import { Terminal, Unavailable } from '../states';
import { DocumentActions } from './document-actions';

// Never cached, never statically rendered: a balance is not a static value.
export const dynamic = 'force-dynamic';

/**
 * The invoice document, per the brand's saved Invoice PDF settings.
 *
 * Reached from the payment page's "Download invoice" action rather than from
 * the emailed link — that link opens the payment page at /i/{token}, and this
 * is the document behind it. Same token, same lookup, same failure pages: a
 * customer who lands here directly is in exactly the position they would be
 * in one level up.
 */
export default async function InvoiceDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await lookupInvoice(token);

  if (result.state === 'not-found') return <Terminal />;
  if (result.state === 'unavailable') return <Unavailable detail={result.detail} />;

  const { invoice } = result;
  const theme = brandThemeVariables(invoice.brand.themeColor);

  return (
    <div className="min-h-full" style={theme as React.CSSProperties}>
      <InvoiceDocument invoice={invoice} actions={<DocumentActions token={token} />} />
    </div>
  );
}
