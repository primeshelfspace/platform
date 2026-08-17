'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download } from 'lucide-react';
import type {
  Brand,
  InvoicePdfLayout,
  InvoicePdfPaymentTerms,
  InvoicePdfSettings,
} from '@/lib/api';
import { Toggle } from '@/components/ui/toggle';
import { saveInvoicePdfSettingsAction, type InvoicePdfState } from './actions';
import { BrandingSubTabs, type BrandingSubTab } from './tabs';

const initialState: InvoicePdfState = {};

const LAYOUTS: readonly { key: InvoicePdfLayout; title: string; description: string }[] = [
  { key: 'CLASSIC', title: 'Classic', description: 'Light, minimal, right-side item table' },
  { key: 'MODERN', title: 'Modern', description: 'Colour header panel, clean two-column layout' },
  {
    key: 'MINIMAL',
    title: 'Minimal',
    description: 'No colour blocks, minimal PDF, clean typography',
  },
];

const PAYMENT_TERMS_OPTIONS: readonly { key: InvoicePdfPaymentTerms; label: string }[] = [
  { key: 'DUE_ON_RECEIPT', label: 'Due on receipt' },
  { key: 'NET_15', label: 'Net 15' },
  { key: 'NET_30', label: 'Net 30' },
  { key: 'NET_60', label: 'Net 60' },
];

function paymentTermsLabel(key: InvoicePdfPaymentTerms): string {
  return PAYMENT_TERMS_OPTIONS.find((option) => option.key === key)?.label ?? 'Due on receipt';
}

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

/** The circular chevron button that collapses/expands a section. Identical
 * to PaymentPageEditor/EmailReceiptEditor's own CollapseToggle — duplicated
 * rather than shared across the three editor files to keep each
 * independently safe to change. */
function CollapseToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted
                 text-ink-muted transition-colors hover:bg-[#E5E7EB] hover:text-ink-strong
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
    >
      {open ? (
        <ChevronUp className="h-4 w-4" aria-hidden />
      ) : (
        <ChevronDown className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

/** A colour row: swatch + hex value, swatch opens a native colour picker.
 * Identical to PaymentPageEditor/EmailReceiptEditor's own ColourField. */
function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const colorInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm font-medium text-ink-strong">{label}</span>
      <button
        type="button"
        onClick={() => colorInputRef.current?.click()}
        className="flex items-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-2.5 py-1.5
                   transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-slate-900 focus-visible:ring-offset-1"
      >
        <span
          className="h-5 w-5 shrink-0 rounded-md border border-black/10"
          style={{ backgroundColor: value }}
          aria-hidden
        />
        <span className="font-mono text-sm text-ink-muted">{value}</span>
        <input
          ref={colorInputRef}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="sr-only"
          aria-hidden
          tabIndex={-1}
        />
      </button>
    </div>
  );
}

export interface InvoicePdfPreviewLineItem {
  description: string;
  quantityLabel: string;
  rateLabel: string;
  amountLabel: string;
}

export interface InvoicePdfPreviewInvoice {
  number: string;
  customerName: string;
  /** Multi-line (newline-separated), possibly empty when the customer has
   * no billing address on file. */
  customerAddress: string;
  invoiceDateLabel: string;
  dueDateLabel: string;
  lineItems: readonly InvoicePdfPreviewLineItem[];
  subtotalLabel: string;
  /** Null when this invoice has no tax applied — the tax row hides itself
   * rather than showing a $0.00 breakdown a merchant never configured. */
  taxLabel: string | null;
  totalLabel: string;
  balanceDueLabel: string;
}

/** Same customer/invoice identity every other editor's preview falls back to
 * when a brand has no invoices yet (see PaymentPagePreviewInvoice's
 * SAMPLE_PREVIEW) — one sample across the app, never a different fake per
 * screen. The two line items are fabricated to sum to that same $4,820.00. */
const SAMPLE_PREVIEW: InvoicePdfPreviewInvoice = {
  number: 'INV-3021',
  customerName: 'Harborline Distributors',
  customerAddress: '789 Elm Avenue, Floor 3\nChicago, Illinois 60601\nUnited States',
  invoiceDateLabel: 'Aug 12, 2026',
  dueDateLabel: 'Aug 26, 2026',
  lineItems: [
    {
      description: 'Consulting services',
      quantityLabel: '20',
      rateLabel: '$200.00',
      amountLabel: '$4,000.00',
    },
    {
      description: 'Software licence',
      quantityLabel: '1',
      rateLabel: '$820.00',
      amountLabel: '$820.00',
    },
  ],
  subtotalLabel: '$4,820.00',
  taxLabel: null,
  totalLabel: '$4,820.00',
  balanceDueLabel: '$4,820.00',
};

/** The rendered invoice — logo/name arranged per layout, sections toggled
 * on/off per Invoice Fields, company info and notes pulled from the form's
 * live state rather than the last-saved settings, so every control's effect
 * is visible before Save Changes is even pressed. */
function InvoicePreviewBody({
  brand,
  layout,
  themeColor,
  logoSrc,
  companyName,
  companyAddress,
  showCompanyAddress,
  showPaymentTerms,
  showTaxBreakdown,
  showNotes,
  paymentTerms,
  notes,
  invoice,
  isSample,
}: {
  brand: Brand;
  layout: InvoicePdfLayout;
  themeColor: string;
  logoSrc: string | null;
  companyName: string;
  companyAddress: string;
  showCompanyAddress: boolean;
  showPaymentTerms: boolean;
  showTaxBreakdown: boolean;
  showNotes: boolean;
  paymentTerms: InvoicePdfPaymentTerms;
  notes: string;
  invoice: InvoicePdfPreviewInvoice;
  isSample: boolean;
}) {
  const logo = (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold"
      style={{ backgroundColor: logoSrc ? undefined : 'rgba(255,255,255,0.2)' }}
      aria-hidden
    >
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt="" className="h-full w-full object-cover" />
      ) : (
        initialOf(companyName)
      )}
    </span>
  );

  const dateRows = (
    <div className="space-y-1 text-right text-sm">
      <p>
        <span className="text-ink-muted">Invoice date: </span>
        {invoice.invoiceDateLabel}
      </p>
      {showPaymentTerms && (
        <p>
          <span className="text-ink-muted">Terms: </span>
          {paymentTermsLabel(paymentTerms)}
        </p>
      )}
      <p>
        <span className="text-ink-muted">Due date: </span>
        {invoice.dueDateLabel}
      </p>
    </div>
  );

  const table = (
    <table className="mt-6 w-full text-sm">
      <thead>
        <tr className="border-b border-[#E5E7EB] text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <th className="pb-2">Item &amp; Description</th>
          <th className="pb-2">Qty</th>
          <th className="pb-2">Rate</th>
          <th className="pb-2 text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {invoice.lineItems.map((line, index) => (
          <tr
            key={`${line.description}-${index}`}
            className="border-b border-[#F1F5F9] last:border-0"
          >
            <td className="py-2 text-ink-strong">{line.description}</td>
            <td className="py-2 text-ink-muted">{line.quantityLabel}</td>
            <td className="py-2 text-ink-muted">{line.rateLabel}</td>
            <td className="py-2 text-right text-ink-strong">{line.amountLabel}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const totals = (
    <div className="mt-6 flex justify-end">
      <div className="w-60 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-muted">Subtotal</span>
          <span className="font-medium text-ink-strong">{invoice.subtotalLabel}</span>
        </div>
        {showTaxBreakdown && invoice.taxLabel && (
          <div className="flex justify-between">
            <span className="text-ink-muted">Tax</span>
            <span className="font-medium text-ink-strong">{invoice.taxLabel}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-[#E5E7EB] pt-1.5 font-bold text-ink-strong">
          <span>Total</span>
          <span>{invoice.totalLabel}</span>
        </div>
        <div className="flex justify-between font-bold" style={{ color: themeColor }}>
          <span>Balance Due</span>
          <span>{invoice.balanceDueLabel}</span>
        </div>
      </div>
    </div>
  );

  const notesBlock = showNotes && (
    <p className="mt-6 whitespace-pre-line border-t border-[#E5E7EB] pt-4 text-xs text-ink-muted">
      {notes}
    </p>
  );

  const sampleBadge = isSample && (
    <p className="mb-4 inline-block rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
      Sample — {brand.displayName} has no invoices yet
    </p>
  );

  if (layout === 'MODERN') {
    return (
      <div>
        <div className="p-6" style={{ backgroundColor: themeColor }}>
          <div className="flex items-start justify-between gap-4 text-white">
            <div className="flex items-start gap-3">
              {logo}
              <div>
                <p className="font-bold">{companyName}</p>
                {showCompanyAddress && companyAddress && (
                  <p className="mt-0.5 whitespace-pre-line text-xs text-white/80">
                    {companyAddress}
                  </p>
                )}
              </div>
            </div>
            <span className="rounded-full bg-white/15 px-3 py-1.5 text-right text-sm font-bold">
              Balance due
              <br />
              {invoice.balanceDueLabel}
            </span>
          </div>
        </div>
        <div className="p-8">
          {sampleBadge}
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">Bill To</p>
              <p className="mt-1 font-semibold text-ink-strong">{invoice.customerName}</p>
              <p className="whitespace-pre-line text-ink-muted">{invoice.customerAddress}</p>
            </div>
            <div>
              <p className="text-right text-sm text-ink-muted">#{invoice.number}</p>
              {dateRows}
            </div>
          </div>
          {table}
          {totals}
          {notesBlock}
        </div>
        <div className="h-1.5" style={{ backgroundColor: themeColor }} aria-hidden />
      </div>
    );
  }

  if (layout === 'MINIMAL') {
    return (
      <div className="p-8">
        {sampleBadge}
        <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-6">
          <div>
            <p className="text-lg font-bold text-ink-strong">{companyName}</p>
            {showCompanyAddress && companyAddress && (
              <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{companyAddress}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tracking-wide text-ink-strong">INVOICE</p>
            <p className="text-sm text-ink-muted">#{invoice.number}</p>
          </div>
        </div>
        <div className="mt-6 flex items-start justify-between gap-4 text-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">Bill To</p>
            <p className="mt-1 font-semibold text-ink-strong">{invoice.customerName}</p>
            <p className="whitespace-pre-line text-ink-muted">{invoice.customerAddress}</p>
          </div>
          {dateRows}
        </div>
        {table}
        {totals}
        {notesBlock}
      </div>
    );
  }

  // CLASSIC
  return (
    <div className="p-8">
      {sampleBadge}
      <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div className="flex items-start gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: logoSrc ? undefined : themeColor }}
            aria-hidden
          >
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt="" className="h-full w-full object-cover" />
            ) : (
              initialOf(companyName)
            )}
          </span>
          <div>
            <p className="font-bold text-ink-strong">{companyName}</p>
            {showCompanyAddress && companyAddress && (
              <p className="mt-0.5 whitespace-pre-line text-xs text-ink-muted">{companyAddress}</p>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tracking-tight text-ink-strong">INVOICE</p>
          <p className="text-sm text-ink-muted">#{invoice.number}</p>
          <span className="mt-2 inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600">
            Balance due {invoice.balanceDueLabel}
          </span>
        </div>
      </div>
      <div className="mt-6 flex items-start justify-between gap-4 text-sm">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">Bill To</p>
          <p className="mt-1 font-semibold text-ink-strong">{invoice.customerName}</p>
          <p className="whitespace-pre-line text-ink-muted">{invoice.customerAddress}</p>
        </div>
        {dateRows}
      </div>
      {table}
      {totals}
      {notesBlock}
    </div>
  );
}

export function InvoicePdfEditor({
  brand,
  activeSub,
  settings,
  previewInvoice,
}: {
  brand: Brand;
  /** Rendered inside the Preview column's own top row — see
   * PaymentPageEditor's identical treatment for why it isn't a separate row
   * above the card. */
  activeSub: BrandingSubTab;
  settings: InvoicePdfSettings;
  previewInvoice: InvoicePdfPreviewInvoice | null;
}) {
  const saveAction = saveInvoicePdfSettingsAction.bind(null, brand);
  const [state, formAction, pending] = useActionState(saveAction, initialState);

  const [themeColor, setThemeColor] = useState(brand.themeColor);
  const [layout, setLayout] = useState<InvoicePdfLayout>(settings.invoicePdfLayout);
  const [showCompanyAddress, setShowCompanyAddress] = useState(settings.showCompanyAddress);
  const [showPaymentTerms, setShowPaymentTerms] = useState(settings.showPaymentTerms);
  const [showTaxBreakdown, setShowTaxBreakdown] = useState(settings.showTaxBreakdown);
  const [showNotes, setShowNotes] = useState(settings.showNotes);
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [companyAddress, setCompanyAddress] = useState(settings.companyAddress);
  const [paymentTerms, setPaymentTerms] = useState<InvoicePdfPaymentTerms>(settings.paymentTerms);
  const [notes, setNotes] = useState(settings.notes);

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoSrc = logoPreview ?? brand.logoUrl;

  const [brandElementsOpen, setBrandElementsOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(true);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [companyInfoOpen, setCompanyInfoOpen] = useState(false);

  const layoutGroupId = useId();
  const paymentTermsId = useId();

  function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    setLogoPreview(URL.createObjectURL(file));
  }

  return (
    <div
      className="mt-4 flex w-fit flex-col divide-y divide-[#E5E7EB] overflow-hidden rounded-2xl
                 border border-[#E5E7EB] bg-white shadow-sm lg:flex-row lg:divide-x lg:divide-y-0"
    >
      <section className="w-[350px] shrink-0 p-6">
        <form action={formAction}>
          <input type="hidden" name="themeColor" value={themeColor} />
          <input type="hidden" name="invoicePdfLayout" value={layout} />
          <input type="hidden" name="paymentTerms" value={paymentTerms} />
          {/* Company info's own fields live inside a collapsible section —
              when it's collapsed those inputs aren't in the DOM at all, so
              nothing of theirs would reach FormData on submit. Hidden
              mirrors here, always rendered regardless of collapse state,
              are the same fix EmailReceiptEditor's Subject/Body already use. */}
          <input type="hidden" name="companyName" value={companyName} />
          <input type="hidden" name="companyAddress" value={companyAddress} />
          <input type="hidden" name="notes" value={notes} />
          <input type="hidden" name="showCompanyAddress" value={showCompanyAddress ? 'on' : ''} />
          <input type="hidden" name="showPaymentTerms" value={showPaymentTerms ? 'on' : ''} />
          <input type="hidden" name="showTaxBreakdown" value={showTaxBreakdown ? 'on' : ''} />
          <input type="hidden" name="showNotes" value={showNotes ? 'on' : ''} />

          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-ink-strong">Brand Elements</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Set default elements that appear across all customer communications.
              </p>
            </div>
            <CollapseToggle
              open={brandElementsOpen}
              onToggle={() => setBrandElementsOpen((open) => !open)}
              label="Brand Elements"
            />
          </div>

          {brandElementsOpen && (
            <div className="mt-4 divide-y divide-[#E5E7EB] border-y border-[#E5E7EB]">
              <div className="flex items-center justify-between py-3">
                <span className="text-sm font-medium text-ink-strong">Logo</span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Upload brand logo"
                  className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                  style={{ backgroundColor: logoSrc ? undefined : themeColor }}
                >
                  {logoSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoSrc} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initialOf(brand.displayName)
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  name="logo"
                  accept="image/jpeg,image/png,image/svg+xml"
                  onChange={handleLogoChange}
                  className="hidden"
                />
              </div>

              <ColourField label="Brand colour" value={themeColor} onChange={setThemeColor} />
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-ink-strong">Invoice Layout</p>
                <p className="mt-1 text-sm text-ink-muted">
                  Choose the visual structure of the generated PDF invoice.
                </p>
              </div>
              <CollapseToggle
                open={layoutOpen}
                onToggle={() => setLayoutOpen((open) => !open)}
                label="Invoice Layout"
              />
            </div>

            {layoutOpen && (
              <div className="mt-3 space-y-2" role="radiogroup" aria-labelledby={layoutGroupId}>
                {LAYOUTS.map(({ key, title, description }) => {
                  const selected = key === layout;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setLayout(key)}
                      className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                        selected
                          ? 'border-ink-strong bg-surface-muted'
                          : 'border-[#E5E7EB] hover:border-[#D1D5DB]'
                      }`}
                    >
                      <span>
                        <span className="block text-sm font-semibold text-ink-strong">{title}</span>
                        <span className="block text-xs text-ink-muted">{description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-ink-strong">Invoice Fields</p>
                <p className="mt-1 text-sm text-ink-muted">
                  Toggle which sections appear on the PDF.
                </p>
              </div>
              <CollapseToggle
                open={fieldsOpen}
                onToggle={() => setFieldsOpen((open) => !open)}
                label="Invoice Fields"
              />
            </div>

            {fieldsOpen && (
              <div className="mt-3 divide-y divide-[#E5E7EB] border-y border-[#E5E7EB]">
                {/* No `name` on these — they're inside this collapsible
                    section, so a checkbox's own presence/absence in FormData
                    would go missing entirely (not just wrong) whenever the
                    section happens to be collapsed at submit time. The
                    hidden mirrors up top (always rendered) are the actual
                    submission source, same fix as Company info's fields. */}
                <Toggle
                  layout="row"
                  checked={showCompanyAddress}
                  onChange={setShowCompanyAddress}
                  label="Company address"
                  hint="Show sender address on the invoice"
                />
                <Toggle
                  layout="row"
                  checked={showPaymentTerms}
                  onChange={setShowPaymentTerms}
                  label="Payment terms"
                  hint="e.g. Net 30, Due on receipt"
                />
                <Toggle
                  layout="row"
                  checked={showTaxBreakdown}
                  onChange={setShowTaxBreakdown}
                  label="Tax breakdown"
                  hint="Show tax as line item separately"
                />
                <Toggle
                  layout="row"
                  checked={showNotes}
                  onChange={setShowNotes}
                  label="Notes"
                  hint="Custom message at the bottom"
                />
              </div>
            )}
          </div>

          <div className="mt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-ink-strong">Company info</p>
              </div>
              <CollapseToggle
                open={companyInfoOpen}
                onToggle={() => setCompanyInfoOpen((open) => !open)}
                label="Company info"
              />
            </div>

            {companyInfoOpen && (
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-ink-strong">
                    Company name
                  </span>
                  <input
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                    className="h-10 w-full rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm text-slate-900
                               shadow-[0_1px_1px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-ink-strong">Address</span>
                  <textarea
                    value={companyAddress}
                    onChange={(event) => setCompanyAddress(event.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-[#D4D4D4] bg-white px-3 py-2 text-sm text-slate-900
                               shadow-[0_1px_1px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                  />
                </label>

                <label className="block" htmlFor={paymentTermsId}>
                  <span className="mb-1 block text-sm font-medium text-ink-strong">
                    Payment terms
                  </span>
                  <select
                    id={paymentTermsId}
                    value={paymentTerms}
                    onChange={(event) =>
                      setPaymentTerms(event.target.value as InvoicePdfPaymentTerms)
                    }
                    className="h-10 w-full appearance-none rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm text-slate-900
                               shadow-[0_1px_1px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                  >
                    {PAYMENT_TERMS_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-ink-strong">Notes</span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-[#D4D4D4] bg-white px-3 py-2 text-sm text-slate-900
                               shadow-[0_1px_1px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                  />
                </label>
              </div>
            )}
          </div>

          {state.error && (
            <p
              role="alert"
              className="mt-6 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {state.error}
            </p>
          )}
          {state.success && (
            <p className="mt-6 rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Saved.
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-6 rounded-[10px] bg-black px-6 py-3 text-sm font-bold text-white transition-colors
                       hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#94A3B8]
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          >
            {pending ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </section>

      <section className="min-w-0 w-[744px] max-w-full p-6">
        {/* BrandingSubTabs carries its own mt-6, meant for sitting below the
            "Brand Settings" page heading — here it's the first thing in a
            padded card, so that margin is cancelled rather than stacking
            with the section's own p-6. */}
        <div className="-mt-6">
          <BrandingSubTabs active={activeSub} brandId={brand.id} />
        </div>
        <div className="mt-6 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink-strong">Preview</h3>
          <button
            type="button"
            disabled
            title="PDF generation isn't built yet — this previews the layout only"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-[#D1D5DB]
                       bg-white px-3 py-1.5 text-xs font-semibold text-ink-strong opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download PDF
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
          <InvoicePreviewBody
            brand={brand}
            layout={layout}
            themeColor={themeColor}
            logoSrc={logoSrc}
            companyName={companyName}
            companyAddress={companyAddress}
            showCompanyAddress={showCompanyAddress}
            showPaymentTerms={showPaymentTerms}
            showTaxBreakdown={showTaxBreakdown}
            showNotes={showNotes}
            paymentTerms={paymentTerms}
            notes={notes}
            invoice={previewInvoice ?? SAMPLE_PREVIEW}
            isSample={!previewInvoice}
          />
        </div>
      </section>
    </div>
  );
}
