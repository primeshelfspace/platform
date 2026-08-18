import { formatDateForDisplay, terminalStatusLabel } from '@fenwick/shared';
import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import {
  getCurrentUser,
  getCustomer,
  getEmailReceiptSettings,
  getInvoicePdfSettings,
  getPaymentPageDisplaySettings,
  listBrands,
  listInvoices,
  type CustomerAddress,
  type EmailReceiptSettings,
  type InvoicePdfSettings,
  type PaymentPageDisplaySettings,
} from '@/lib/api';
import { PageContainer } from '@/components/page-container';
import { BrandDetailsForm } from './brand-details-form';
import { EmailReceiptEditor } from './email-receipt-editor';
import { InvoicePdfEditor, type InvoicePdfPreviewInvoice } from './invoice-pdf-editor';
import { PaymentPageEditor, type PaymentPagePreviewInvoice } from './payment-page-editor';
import {
  BrandSettingsTabs,
  BrandingSubTabs,
  isBrandSettingsTab,
  isBrandingSubTab,
  type BrandSettingsTab,
  type BrandingSubTab,
} from './tabs';

export const dynamic = 'force-dynamic';

// Same convention as the Invoices list page's "Open payment page" link.
const PAYMENT_PUBLIC_URL = process.env['NEXT_PUBLIC_PAYMENT_PUBLIC_URL'] ?? 'http://localhost:3001';

/**
 * What the Payment Page tab's preview shows: this brand's actual most recent
 * invoice, never an invented one (FR-PAY design note — the reference mockup's
 * example numbers must not leak into a real settings screen). `null` when the
 * brand has no invoices yet; the preview then says so instead of faking one.
 */
async function loadPreviewInvoice(brandId: string): Promise<PaymentPagePreviewInvoice | null> {
  let latest;
  try {
    latest = (await listInvoices(brandId, { pageSize: 1 })).data[0];
  } catch {
    return null;
  }
  if (!latest) return null;

  // A customer that fails to load is not worth losing the rest of the
  // preview over — the amount, date and layout still say something real.
  let customerName = 'Customer';
  try {
    customerName = (await getCustomer(brandId, latest.customerId)).displayName;
  } catch {
    // Intentionally ignored — see comment above.
  }

  const settledLabel = terminalStatusLabel(latest.status);

  return {
    number: latest.number,
    customerName,
    amountLabel: formatMinorForDisplay(latest.balanceMinor, toCurrencyCode(latest.currency)),
    dueDateLabel: formatDateForDisplay(latest.dueDate),
    isSettled: settledLabel !== null,
    settledLabel,
    // A draft has no public token worth linking to yet.
    viewUrl: latest.status === 'DRAFT' ? null : `${PAYMENT_PUBLIC_URL}/i/${latest.publicToken}`,
  };
}

/** Two lines the way a person addresses an envelope — "street, suite" then
 * "city, region postal" — same convention as the customer detail drawer's
 * own addressLines, duplicated rather than shared since one is a server
 * component and the other a client component with no common module between
 * them worth introducing for six lines. */
function formatAddressLines(address: CustomerAddress | null): string {
  if (!address) return '';
  const line1 = [address.line1, address.line2].filter(Boolean).join(', ');
  const line2 = [[address.city, address.region].filter(Boolean).join(', '), address.postalCode]
    .filter(Boolean)
    .join(' ');
  return [line1, line2].filter(Boolean).join('\n');
}

/**
 * What the Invoice PDF tab's preview renders: this brand's actual most
 * recent invoice (with real line items), never an invented one — same
 * FR-PAY design note loadPreviewInvoice follows. `null` when the brand has
 * no invoices yet; the editor then shows the same sample every other
 * Branding preview falls back to, clearly labelled as a sample.
 */
async function loadInvoicePdfPreview(brandId: string): Promise<InvoicePdfPreviewInvoice | null> {
  let latest;
  try {
    latest = (await listInvoices(brandId, { pageSize: 1 })).data[0];
  } catch {
    return null;
  }
  if (!latest) return null;

  let customerName = 'Customer';
  let customerAddress = '';
  try {
    const customer = await getCustomer(brandId, latest.customerId);
    customerName = customer.displayName;
    customerAddress = formatAddressLines(customer.billingAddress);
  } catch {
    // Intentionally ignored — see loadPreviewInvoice's own comment.
  }

  const currency = toCurrencyCode(latest.currency);

  return {
    number: latest.number,
    customerName,
    customerAddress,
    invoiceDateLabel: formatDateForDisplay(latest.invoiceDate),
    dueDateLabel: formatDateForDisplay(latest.dueDate),
    lineItems: latest.lineItems.map((line) => ({
      description: line.itemName,
      quantityLabel: String(line.quantity),
      rateLabel: formatMinorForDisplay(line.unitPriceMinor, currency),
      amountLabel: formatMinorForDisplay(line.lineTotalMinor, currency),
    })),
    subtotalLabel: formatMinorForDisplay(latest.subtotalMinor, currency),
    taxLabel: latest.taxMinor > 0 ? formatMinorForDisplay(latest.taxMinor, currency) : null,
    totalLabel: formatMinorForDisplay(latest.totalMinor, currency),
    balanceDueLabel: formatMinorForDisplay(latest.balanceMinor, currency),
  };
}

/**
 * The sidebar's "Brand Settings" destination. Scoped to whichever brand the
 * sidebar's brandId query param currently points at — the same convention
 * every other brand-scoped page in this app already follows.
 *
 * Brand Details and Branding render here; Integrations and Payment Gateways
 * are tabs that link out to their existing standalone pages (see tabs.tsx).
 * All three Branding sub-tabs (Payment Page, Email Receipt, Invoice PDF) are
 * built.
 */
export default async function BrandSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; tab?: string; sub?: string }>;
}) {
  const params = await searchParams;
  const brands = await listBrands();
  const brand = brands.find((b) => b.id === params.brandId) ?? brands[0];
  const activeTab: BrandSettingsTab = isBrandSettingsTab(params.tab) ? params.tab : 'details';
  const activeSub: BrandingSubTab = isBrandingSubTab(params.sub) ? params.sub : 'email-receipt';

  // Each sub-tab's data calls are independent of one another (none reads the
  // others' result) — fetched together so the slowest one sets the wait
  // instead of the sum of all of them.
  let paymentPageProps: {
    display: PaymentPageDisplaySettings;
    previewInvoice: PaymentPagePreviewInvoice | null;
  } | null = null;
  let emailReceiptProps: {
    settings: EmailReceiptSettings;
    accentColor: string;
    previewInvoice: PaymentPagePreviewInvoice | null;
    /** Where "Send Test Email" sends to — the signed-in user's own address,
     * so there's nothing to type. Null only if the session lookup itself
     * fails, in which case the button disables rather than sending nowhere. */
    userEmail: string | null;
  } | null = null;
  let invoicePdfProps: {
    settings: InvoicePdfSettings;
    previewInvoice: InvoicePdfPreviewInvoice | null;
  } | null = null;
  if (brand && activeTab !== 'details') {
    if (activeSub === 'payment-page') {
      const [display, previewInvoice] = await Promise.all([
        getPaymentPageDisplaySettings(brand.id),
        loadPreviewInvoice(brand.id),
      ]);
      paymentPageProps = { display, previewInvoice };
    } else if (activeSub === 'email-receipt') {
      const [settings, display, previewInvoice, userEmail] = await Promise.all([
        getEmailReceiptSettings(brand.id),
        getPaymentPageDisplaySettings(brand.id),
        loadPreviewInvoice(brand.id),
        getCurrentUser()
          .then((u) => u.email)
          .catch(() => null),
      ]);
      emailReceiptProps = { settings, accentColor: display.accentColor, previewInvoice, userEmail };
    } else if (activeSub === 'invoice-pdf') {
      const [settings, previewInvoice] = await Promise.all([
        getInvoicePdfSettings(brand.id),
        loadInvoicePdfPreview(brand.id),
      ]);
      invoicePdfProps = { settings, previewInvoice };
    }
  }

  return (
    <PageContainer>
      {brand && <p className="text-sm text-ink-muted">{brand.displayName}</p>}
      <h1 className="mt-2 text-2xl font-bold text-ink-strong">Brand Settings</h1>

      <BrandSettingsTabs active={activeTab} brandId={brand?.id} />

      {!brand ? (
        <p className="mt-8 text-sm text-ink-muted">No brand exists to configure yet.</p>
      ) : activeTab === 'details' ? (
        <div className="mt-8">
          <BrandDetailsForm brand={brand} />
        </div>
      ) : (
        <>
          {/* Branches on activeSub itself — the props objects above are
              filled in by the identical condition, so the assertions below
              just tell TS what's already guaranteed true at runtime. All
              three Branding sub-tabs are built; there is no remaining
              fallback case. */}
          {activeSub === 'payment-page' ? (
            <PaymentPageEditor
              brand={brand}
              activeSub={activeSub}
              display={paymentPageProps!.display}
              previewInvoice={paymentPageProps!.previewInvoice}
            />
          ) : activeSub === 'email-receipt' ? (
            <EmailReceiptEditor
              brand={brand}
              activeSub={activeSub}
              settings={emailReceiptProps!.settings}
              accentColor={emailReceiptProps!.accentColor}
              previewInvoice={emailReceiptProps!.previewInvoice}
              userEmail={emailReceiptProps!.userEmail}
            />
          ) : (
            <InvoicePdfEditor
              brand={brand}
              activeSub={activeSub}
              settings={invoicePdfProps!.settings}
              previewInvoice={invoicePdfProps!.previewInvoice}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
