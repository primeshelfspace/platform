import { formatMinorForDisplay, toCurrencyCode } from '@fenwick/shared/money';
import {
  getCustomer,
  getEmailReceiptSettings,
  getPaymentPageDisplaySettings,
  listBrands,
  listInvoices,
} from '@/lib/api';
import { PageContainer } from '@/components/page-container';
import { BrandDetailsForm } from './brand-details-form';
import { EmailReceiptEditor } from './email-receipt-editor';
import { PaymentPageEditor, type PaymentPagePreviewInvoice } from './payment-page-editor';
import {
  BrandSettingsTabs,
  BrandingSubTabs,
  NotBuiltYet,
  isBrandSettingsTab,
  isBrandingSubTab,
  type BrandSettingsTab,
  type BrandingSubTab,
} from './tabs';

export const dynamic = 'force-dynamic';

// Same convention as the Invoices list page's "Open payment page" link.
const PAYMENT_PUBLIC_URL = process.env['NEXT_PUBLIC_PAYMENT_PUBLIC_URL'] ?? 'http://localhost:3001';

const SETTLED_INVOICE_LABEL: Record<string, string> = {
  PAID: 'This invoice has been paid.',
  CANCELLED: 'This invoice was cancelled.',
};

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

  const settledLabel = SETTLED_INVOICE_LABEL[latest.status] ?? null;

  return {
    number: latest.number,
    customerName,
    amountLabel: formatMinorForDisplay(latest.balanceMinor, toCurrencyCode(latest.currency)),
    dueDateLabel: new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(latest.dueDate)),
    isSettled: settledLabel !== null,
    settledLabel,
    // A draft has no public token worth linking to yet.
    viewUrl: latest.status === 'DRAFT' ? null : `${PAYMENT_PUBLIC_URL}/i/${latest.publicToken}`,
  };
}

/**
 * The sidebar's "Brand Settings" destination. Scoped to whichever brand the
 * sidebar's brandId query param currently points at — the same convention
 * every other brand-scoped page in this app already follows.
 *
 * Brand Details and Branding render here; Integrations and Payment Gateways
 * are tabs that link out to their existing standalone pages (see tabs.tsx).
 * Within Branding, only Payment Page is built — Email Receipt and Invoice
 * PDF say so in plain words rather than being hidden.
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

  return (
    <PageContainer>
      {brand && <p className="text-sm text-ink-muted">{brand.displayName}</p>}
      <h1 className="mt-1 text-2xl font-bold text-ink-strong">Brand Settings</h1>

      <BrandSettingsTabs active={activeTab} brandId={brand?.id} />

      {!brand ? (
        <p className="mt-8 text-sm text-ink-muted">No brand exists to configure yet.</p>
      ) : activeTab === 'details' ? (
        <div className="mt-8">
          <BrandDetailsForm brand={brand} />
        </div>
      ) : (
        <>
          {/* Right-aligned to sit above the preview column, not the settings
              column — matches the reference design; the empty left cell uses
              the same grid/gap as PaymentPageEditor's below so the two line up. */}
          <div className="grid gap-10 lg:grid-cols-2">
            <div aria-hidden />
            <BrandingSubTabs active={activeSub} brandId={brand.id} />
          </div>
          {activeSub === 'payment-page' ? (
            <PaymentPageEditor
              brand={brand}
              display={await getPaymentPageDisplaySettings(brand.id)}
              previewInvoice={await loadPreviewInvoice(brand.id)}
            />
          ) : activeSub === 'email-receipt' ? (
            <EmailReceiptEditor
              brand={brand}
              settings={await getEmailReceiptSettings(brand.id)}
              accentColor={(await getPaymentPageDisplaySettings(brand.id)).accentColor}
              previewInvoice={await loadPreviewInvoice(brand.id)}
            />
          ) : (
            <NotBuiltYet tab={activeSub} />
          )}
        </>
      )}
    </PageContainer>
  );
}
