'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Download } from 'lucide-react';
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
  // 52px with a white ring, not the plain 44px this used to be — confirmed
  // against Modern's own Figma export (a 52px circle with a 2px white
  // stroke), same way Classic's avatar size/ring were confirmed earlier.
  const logo = (
    <span
      className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white text-sm font-bold"
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

  // Values are bold (ink-strong), labels stay muted — the label/value
  // contrast the reference relies on.
  const dateRows = (
    <div className="space-y-1 text-right text-sm">
      <p>
        <span className="text-ink-muted">Invoice date: </span>
        <span className="font-bold text-ink-strong">{invoice.invoiceDateLabel}</span>
      </p>
      {showPaymentTerms && (
        <p>
          <span className="text-ink-muted">Terms: </span>
          <span className="font-bold text-ink-strong">{paymentTermsLabel(paymentTerms)}</span>
        </p>
      )}
      <p>
        <span className="text-ink-muted">Due date: </span>
        <span className="font-bold text-ink-strong">{invoice.dueDateLabel}</span>
      </p>
    </div>
  );

  // All three layouts get the row-number column and filled header bar now
  // — confirmed against Minimal's own reference too, so this is no longer
  // a per-layout choice. Kept as a named constant rather than inlining
  // `true` everywhere below, in case that changes again.
  const decorated = true;
  const table = (
    <table className="mt-6 w-full text-sm">
      <thead>
        <tr
          className={`text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle ${
            decorated ? 'bg-surface-muted' : 'border-b border-[#E5E7EB]'
          }`}
        >
          {decorated && <th className="w-10 py-2 pl-4">#</th>}
          <th className="py-2">Item &amp; Description</th>
          <th className="py-2">Qty</th>
          <th className="py-2">Rate</th>
          <th className={`py-2 text-right ${decorated ? 'pr-4' : ''}`}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {/* Every row gets the line now, including the last one — no more
            `last:border-0` exception, per the reference. */}
        {invoice.lineItems.map((line, index) => (
          <tr key={`${line.description}-${index}`} className="border-b border-[#F1F5F9]">
            {decorated && <td className="py-3 pl-4 text-ink-muted">{index + 1}</td>}
            <td className="py-3 text-ink-strong">{line.description}</td>
            <td className="py-3 text-ink-muted">{line.quantityLabel}</td>
            <td className="py-3 text-ink-muted">{line.rateLabel}</td>
            <td className={`py-3 text-right text-ink-strong ${decorated ? 'pr-4' : ''}`}>
              {line.amountLabel}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  // Modern boxes its totals in a bordered card with a shaded Balance Due
  // row, instead of Classic/Minimal's plain stacked lines — two genuinely
  // different totals treatments per the reference designs, not a single
  // shared one.
  const totals =
    layout === 'MODERN' ? (
      <div className="mt-6 flex justify-end">
        <div className="w-64 overflow-hidden rounded-lg border border-[#E5E7EB] text-sm">
          <div className="flex justify-between px-4 py-2.5">
            <span className="text-ink-muted">Subtotal</span>
            <span className="font-medium text-ink-strong">{invoice.subtotalLabel}</span>
          </div>
          {showTaxBreakdown && invoice.taxLabel && (
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-ink-muted">Tax</span>
              <span className="font-medium text-ink-strong">{invoice.taxLabel}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-[#E5E7EB] px-4 py-2.5 font-bold text-ink-strong">
            <span>Total</span>
            <span>{invoice.totalLabel}</span>
          </div>
          <div className="flex justify-between bg-surface-muted px-4 py-2.5 font-bold text-ink-strong">
            <span>Balance Due</span>
            <span>{invoice.balanceDueLabel}</span>
          </div>
        </div>
      </div>
    ) : (
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
          {/* The bold rule sits between Total and Balance Due, not above
              Total — Total keeps the regular thin #E5E7EB weight like
              every other line above it. Balance Due's text is black
              (ink-strong), not the theme colour. */}
          <div className="flex justify-between border-t border-[#E5E7EB] pt-1.5 font-bold text-ink-strong">
            <span>Total</span>
            <span>{invoice.totalLabel}</span>
          </div>
          <div className="flex justify-between border-t-2 border-ink-strong pt-1.5 font-bold text-ink-strong">
            <span>Balance Due</span>
            <span>{invoice.balanceDueLabel}</span>
          </div>
        </div>
      </div>
    );

  const notesBlock = showNotes && (
    <div className="mt-6 border-t border-[#E5E7EB] pt-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">Notes</p>
      <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{notes}</p>
    </div>
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
            <div className="text-right">
              {/* Inverted hierarchy from Classic: here "INVOICE" is a
                  small muted label and the invoice number is the bold,
                  prominent line underneath it — not a big wordmark with a
                  muted number below, per the reference design. */}
              <p className="text-sm uppercase tracking-wide text-white/70">Invoice</p>
              <p className="mt-1 text-2xl font-bold text-white">#{invoice.number}</p>
              <p className="mt-2 text-sm font-bold text-white">
                Balance due: {invoice.balanceDueLabel}
              </p>
            </div>
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
            {dateRows}
          </div>
          {table}
          {totals}
          {notesBlock}
        </div>
        {/* No bottom colour strip here — Modern's own reference design
            doesn't have one; only Classic does (see its own strip further
            down, outside its p-8 wrapper). */}
      </div>
    );
  }

  if (layout === 'MINIMAL') {
    return (
      <div className="p-8">
        {sampleBadge}
        <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] pb-6">
          <div className="flex items-start gap-3">
            {/* Same avatar recipe as Classic (59px, light #E5E5E5 ring,
                theme-colour fallback) — Minimal isn't logo-less, just
                colour-block-free, per the reference. */}
            <span
              className="flex h-[59px] w-[59px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#E5E5E5] text-lg font-bold text-white"
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
              <p className="text-lg font-bold text-ink-strong">{companyName}</p>
              {showCompanyAddress && companyAddress && (
                <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{companyAddress}</p>
              )}
            </div>
          </div>
          <div className="text-right">
            {/* Same inverted hierarchy as Modern: "INVOICE" is the small
                muted label, the number is the bold prominent line. */}
            <p className="text-sm uppercase tracking-wide text-ink-subtle">Invoice</p>
            <p className="mt-1 text-2xl font-bold text-ink-strong">#{invoice.number}</p>
          </div>
        </div>
        {/* Balance Due callout — a themed accent bar on the left, muted
            label, large bold amount. Doesn't exist anywhere else in
            Minimal; this is its one deliberate colour touch, per the
            reference (the layout's own description undersells this a
            bit — "no colour blocks" evidently still allows one accent
            bar). */}
        <div className="mt-6 flex items-stretch gap-3">
          <div className="w-1 shrink-0 rounded-full" style={{ backgroundColor: themeColor }} />
          <div>
            <p className="text-sm text-ink-muted">Balance due</p>
            <p className="text-3xl font-bold text-ink-strong">{invoice.balanceDueLabel}</p>
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
    <div>
      <div className="p-8">
        {sampleBadge}
        {/* border/divider colour and avatar size confirmed against the Figma
          export for this screen: #F3F4F6 (not the #E5E7EB used elsewhere in
          this file) and a 59px circle with a light #E5E5E5 ring. */}
        <div className="flex items-start justify-between gap-4 border-b border-[#F3F4F6] pb-6">
          <div>
            <span
              className="flex h-[59px] w-[59px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#E5E5E5] text-lg font-bold text-white"
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
            <p className="mt-4 text-xl font-bold text-ink-strong">{companyName}</p>
            {showCompanyAddress && companyAddress && (
              <p className="mt-1 max-w-[220px] whitespace-pre-line text-sm text-ink-muted">
                {companyAddress}
              </p>
            )}
          </div>
          <div className="text-right">
            {/* Exact wordmark from the reference design (its path traces
              I-N-V-O-I-C-E), not the text-4xl font-extrabold heading this
              used to be — kept as an inline SVG rather than a font so the
              letterforms render identically to the design regardless of
              which fonts are installed.
              Height matches the reference's 38px frame; width is left to
              scale naturally off the viewBox's own 125:24 ratio (~198px)
              instead of being forced to the frame's 128px — forcing both
              stretched the letters noticeably (preserveAspectRatio="none"
              on a 125:24 shape squeezed into a 128:38 box is a real
              distortion, not a rounding error), which is what looked wrong. */}
            <svg
              viewBox="0 0 125 24"
              height={38}
              style={{ transform: 'rotate(0deg)', opacity: 1 }}
              className="ml-auto w-auto"
              fill="none"
              role="img"
              aria-label="Invoice"
            >
              <path
                d="M-0.000468761 22.71V0.359959H4.64953V22.71H-0.000468761ZM8.61281 22.71V0.359959H12.1828L24.1828 16.17L22.2628 16.62V0.359959H26.9128V22.71H23.3128L11.5228 6.77996L13.2628 6.32996V22.71H8.61281ZM36.8784 22.71L29.2284 0.359959H34.3284L40.0884 18.3H39.0684L44.8284 0.359959H49.9284L42.2784 22.71H36.8784ZM62.8399 23.07C61.1599 23.07 59.5999 22.78 58.1599 22.2C56.7199 21.62 55.4599 20.81 54.3799 19.77C53.3199 18.71 52.4899 17.48 51.8899 16.08C51.2899 14.68 50.9899 13.16 50.9899 11.52C50.9899 9.87996 51.2799 8.35996 51.8599 6.95996C52.4599 5.55996 53.2899 4.33996 54.3499 3.29996C55.4299 2.25996 56.6899 1.44996 58.1299 0.86996C59.5699 0.28996 61.1399 -3.99351e-05 62.8399 -3.99351e-05C64.5399 -3.99351e-05 66.1099 0.28996 67.5499 0.86996C68.9899 1.44996 70.2399 2.25996 71.2999 3.29996C72.3799 4.33996 73.2099 5.55996 73.7899 6.95996C74.3899 8.35996 74.6899 9.87996 74.6899 11.52C74.6899 13.16 74.3899 14.68 73.7899 16.08C73.1899 17.48 72.3499 18.71 71.2699 19.77C70.2099 20.81 68.9599 21.62 67.5199 22.2C66.0799 22.78 64.5199 23.07 62.8399 23.07ZM62.8399 18.87C63.8599 18.87 64.7999 18.69 65.6599 18.33C66.5399 17.97 67.3099 17.47 67.9699 16.83C68.6299 16.17 69.1399 15.39 69.4999 14.49C69.8599 13.59 70.0399 12.6 70.0399 11.52C70.0399 10.44 69.8599 9.45996 69.4999 8.57996C69.1399 7.67996 68.6299 6.89996 67.9699 6.23996C67.3099 5.57996 66.5399 5.07996 65.6599 4.73996C64.7999 4.37996 63.8599 4.19996 62.8399 4.19996C61.8199 4.19996 60.8699 4.37996 59.9899 4.73996C59.1299 5.07996 58.3699 5.57996 57.7099 6.23996C57.0499 6.89996 56.5399 7.67996 56.1799 8.57996C55.8199 9.45996 55.6399 10.44 55.6399 11.52C55.6399 12.6 55.8199 13.59 56.1799 14.49C56.5399 15.39 57.0499 16.17 57.7099 16.83C58.3699 17.47 59.1299 17.97 59.9899 18.33C60.8699 18.69 61.8199 18.87 62.8399 18.87ZM77.9878 22.71V0.359959H82.6378V22.71H77.9878ZM97.2211 23.07C95.6211 23.07 94.1311 22.78 92.7511 22.2C91.3911 21.62 90.2011 20.81 89.1811 19.77C88.1611 18.73 87.3611 17.51 86.7811 16.11C86.2211 14.71 85.9411 13.18 85.9411 11.52C85.9411 9.85996 86.2211 8.32996 86.7811 6.92996C87.3411 5.50996 88.1311 4.28996 89.1511 3.26996C90.1711 2.22996 91.3611 1.42996 92.7211 0.86996C94.1011 0.28996 95.6011 -3.99351e-05 97.2211 -3.99351e-05C98.8411 -3.99351e-05 100.291 0.26996 101.571 0.80996C102.871 1.34996 103.971 2.06996 104.871 2.96996C105.771 3.86996 106.411 4.86996 106.791 5.96996L102.681 7.94996C102.301 6.86996 101.631 5.97996 100.671 5.27996C99.7311 4.55996 98.5811 4.19996 97.2211 4.19996C95.9011 4.19996 94.7411 4.50996 93.7411 5.12996C92.7411 5.74996 91.9611 6.60996 91.4011 7.70996C90.8611 8.78996 90.5911 10.06 90.5911 11.52C90.5911 12.98 90.8611 14.26 91.4011 15.36C91.9611 16.46 92.7411 17.32 93.7411 17.94C94.7411 18.56 95.9011 18.87 97.2211 18.87C98.5811 18.87 99.7311 18.52 100.671 17.82C101.631 17.1 102.301 16.2 102.681 15.12L106.791 17.1C106.411 18.2 105.771 19.2 104.871 20.1C103.971 21 102.871 21.72 101.571 22.26C100.291 22.8 98.8411 23.07 97.2211 23.07ZM109.775 22.71V0.359959H124.805V4.40996H114.425V9.47996H124.205V13.53H114.425V18.66H124.805V22.71H109.775Z"
                fill="#101828"
              />
            </svg>
            <p className="mt-1 text-base text-ink-muted"># {invoice.number}</p>
            {/* Thicker/bolder than the light bg-red-50 chip this used to be —
              solid theme colour fill, white text, generous padding, per the
              reference design. */}
            <span
              className="mt-3 inline-block rounded-full px-4 py-2 text-sm font-bold text-white"
              style={{ backgroundColor: themeColor }}
            >
              Balance due: {invoice.balanceDueLabel}
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
      {/* Full-bleed, border to border — moved outside the p-8 wrapper above
          so it isn't inset by that padding, same as Modern's own bottom
          strip. The preview card's own overflow-hidden + rounded-2xl (see
          InvoicePdfEditor's preview wrapper) clips this to follow the
          card's rounded bottom corners without needing rounding here. */}
      <div className="h-2" style={{ backgroundColor: themeColor }} aria-hidden />
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
                      {selected && (
                        <Check className="h-4 w-4 shrink-0 text-ink-strong" aria-hidden />
                      )}
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
              <div className="mt-3">
                {/* No `name` on these — they're inside this collapsible
                    section, so a checkbox's own presence/absence in FormData
                    would go missing entirely (not just wrong) whenever the
                    section happens to be collapsed at submit time. The
                    hidden mirrors up top (always rendered) are the actual
                    submission source, same fix as Company info's fields.
                    `divided={false}`: no rule between rows here, per the
                    reference — the outer border-y/divide-y that used to sit
                    on this wrapper is gone too, for the same reason. */}
                <Toggle
                  layout="row"
                  divided={false}
                  checked={showCompanyAddress}
                  onChange={setShowCompanyAddress}
                  label="Company address"
                  hint="Show sender address on the invoice"
                />
                <Toggle
                  layout="row"
                  divided={false}
                  checked={showPaymentTerms}
                  onChange={setShowPaymentTerms}
                  label="Payment terms"
                  hint="e.g. Net 30, Due on receipt"
                />
                <Toggle
                  layout="row"
                  divided={false}
                  checked={showTaxBreakdown}
                  onChange={setShowTaxBreakdown}
                  label="Tax breakdown"
                  hint="Show tax as line item separately"
                />
                <Toggle
                  layout="row"
                  divided={false}
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
          {/* text-black, not the faded look opacity-50 used to give it —
              the border/bg alone (plus cursor-not-allowed and the title
              tooltip) already communicate disabled without washing out
              the label to gray. */}
          <button
            type="button"
            disabled
            title="PDF generation isn't built yet — this previews the layout only"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-[#D1D5DB]
                       bg-white px-3 py-1.5 text-xs font-semibold text-black"
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
