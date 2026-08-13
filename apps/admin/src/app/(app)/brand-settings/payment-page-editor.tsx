'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  ExternalLink,
  FileCheck2,
  Landmark,
  Monitor,
  Smartphone,
  Wallet,
} from 'lucide-react';
import type { Brand, PaymentPageDisplaySettings, PaymentPageLayout } from '@/lib/api';
import { savePaymentPageDisplayAction, type PaymentPageDisplayState } from './actions';
import { BrandingSubTabs, type BrandingSubTab } from './tabs';

const initialState: PaymentPageDisplayState = {};

/**
 * What this panel previews. Built server-side in page.tsx from the brand's
 * actual most recent invoice — never invented here — so this settings screen
 * cannot show a number, customer or "paid" state that does not exist. `null`
 * means the brand has no invoices yet; the preview then falls back to
 * SAMPLE_PREVIEW below, clearly labelled as a sample, so there is still
 * something to style-check before a real invoice exists.
 */
export interface PaymentPagePreviewInvoice {
  number: string;
  customerName: string;
  amountLabel: string;
  dueDateLabel: string;
  /** Terminal invoice states get the same no-payment-form treatment the real
   * hosted payment page gives them — see apps/payment's own TERMINAL_STATUSES. */
  isSettled: boolean;
  settledLabel: string | null;
  /** Null when the invoice is still a draft — there is no public link yet. */
  viewUrl: string | null;
}

/** Shown only when a brand has no invoices yet. Always paired with the
 * "Sample" badge below, which is what makes reusing the reference mockup's
 * own numbers safe here — it reads as a styled example, not a real invoice. */
const SAMPLE_PREVIEW: Omit<PaymentPagePreviewInvoice, 'isSettled' | 'settledLabel' | 'viewUrl'> = {
  number: 'INV-3021',
  customerName: 'Harborline Distributors',
  amountLabel: '$4,820.00',
  dueDateLabel: 'Aug 26, 2026',
};

const LAYOUTS: readonly { key: PaymentPageLayout; title: string; description: string }[] = [
  { key: 'BANNER', title: 'Banner', description: 'Full-width brand banner with logo and name' },
  { key: 'CENTERED', title: 'Centered', description: 'Centered avatar logo with brand name below' },
  { key: 'SPLIT', title: 'Split', description: 'Invoice summary left, payment form right' },
];

type MethodKey = 'card' | 'ach' | 'wallet' | 'check';

const METHODS: readonly { key: MethodKey; label: string; icon: typeof CreditCard }[] = [
  { key: 'card', label: 'Credit / Debit Card', icon: CreditCard },
  { key: 'ach', label: 'ACH Bank Transfer', icon: Landmark },
  { key: 'wallet', label: 'Digital Wallet', icon: Wallet },
  { key: 'check', label: 'Upload Check', icon: FileCheck2 },
];

const inputClass =
  'w-full h-10 rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm text-slate-900 ' +
  'shadow-[0_1px_1px_rgba(0,0,0,0.05)] placeholder:text-slate-400 focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 transition-colors';

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

/** The circular chevron button that collapses/expands a section — Brand
 * Elements and Page layout each get one; collapsing only hides the fields,
 * it never resets or discards whatever was already chosen inside. */
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

/** A colour row: swatch + hex value, swatch opens a native colour picker. */
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

/** The invoice summary block shown inside the preview — same content in
 * every layout, laid out differently per layout. Renders the brand's actual
 * most recent invoice; a brand with none yet gets a placeholder that says so
 * rather than an invented number. */
function InvoiceSummary({
  invoice,
  centered,
  light,
}: {
  invoice: PaymentPagePreviewInvoice | null;
  centered?: boolean;
  /** Renders white-on-colour instead of dark-on-white — for the Split
   * layout's full-bleed brand-colour panel, where the default dark/blue/orange
   * palette would be unreadable against a saturated background. */
  light?: boolean;
}) {
  // No invoice yet: fall back to SAMPLE_PREVIEW so there's still a full page
  // to style-check, but badge and caption it clearly — this must never read
  // as a real invoice (see PaymentPagePreviewInvoice's comment).
  const isSample = !invoice;
  const data = invoice ?? SAMPLE_PREVIEW;

  const sampleBadge = isSample && (
    <span
      className={`ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide ${
        light ? 'bg-white/20 text-white' : 'bg-surface-muted text-ink-subtle'
      }`}
    >
      Sample
    </span>
  );

  return (
    <div className={centered ? 'text-center' : ''}>
      {light ? (
        <p className="text-base font-bold leading-snug text-white">
          <span className="block">Invoice {data.number}</span>
          <span className="block">
            {data.customerName}
            {sampleBadge}
          </span>
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          Invoice {data.number} &bull; {data.customerName}
          {sampleBadge}
        </p>
      )}
      <p
        className={`${light ? 'mt-2' : 'mt-1'} text-3xl font-bold ${light ? 'text-white' : 'text-ink-strong'}`}
      >
        {data.amountLabel}
      </p>
      <div
        className={`flex text-sm ${light ? 'mt-4 gap-4' : 'mt-2 gap-3'} ${light ? 'text-white' : 'text-ink-muted'} ${
          light ? 'font-bold' : ''
        } ${centered ? 'flex-col items-center' : light ? 'flex-col items-start' : 'items-center justify-between'}`}
      >
        <span>
          Due Date:{' '}
          <span className={light ? undefined : 'font-semibold text-orange-600'}>
            {data.dueDateLabel}
          </span>
        </span>
        {invoice?.viewUrl && (
          <a
            href={invoice.viewUrl}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1.5 rounded-lg border font-semibold ${
              light
                ? 'border-white bg-transparent px-4 py-2 text-sm text-white hover:bg-white/10'
                : 'border-blue-600 bg-white px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50'
            }`}
          >
            View Invoice
            <ExternalLink className={light ? 'h-4 w-4' : 'h-3 w-3'} aria-hidden />
          </a>
        )}
      </div>
      {isSample && (
        <p
          className={`mt-2 text-xs ${light ? 'text-white/70' : 'text-ink-subtle'} ${centered ? 'text-center' : ''}`}
        >
          Sample data — create an invoice for this brand to preview your real numbers here.
        </p>
      )}
    </div>
  );
}

function MethodGrid({
  selected,
  onSelect,
  accentColor,
}: {
  selected: MethodKey;
  onSelect: (key: MethodKey) => void;
  accentColor: string;
}) {
  return (
    <div>
      <p className="text-sm font-bold text-ink-strong">Choose how to pay</p>
      <div className="mt-3 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Payment method">
        {METHODS.map(({ key, label, icon: Icon }) => {
          const isSelected = key === selected;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(key)}
              style={isSelected ? { borderColor: accentColor } : undefined}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                isSelected
                  ? 'border-2 text-ink-strong'
                  : 'border-[#E5E7EB] text-ink-muted hover:border-[#D1D5DB]'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CardDetailsForm() {
  return (
    <div className="mt-5">
      <p className="text-sm font-bold text-ink-strong">Card details</p>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Card number</span>
          <input inputMode="numeric" placeholder="1234 5678 9012 3456" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Cardholder name</span>
          <input placeholder="John Smith" className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Expiry date</span>
            <input placeholder="MM / YY" className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">CVV</span>
            <input placeholder="•••" inputMode="numeric" className={inputClass} />
          </label>
        </div>
      </div>
    </div>
  );
}

function PayButton({ accentColor, amountLabel }: { accentColor: string; amountLabel: string }) {
  return (
    <button
      type="button"
      style={{ backgroundColor: accentColor }}
      className="mt-5 w-full rounded-lg py-3 text-sm font-bold text-white transition-opacity hover:opacity-90"
    >
      Pay {amountLabel}
    </button>
  );
}

/** What the real hosted payment page shows instead of a payment form once an
 * invoice is settled (apps/payment mirrors this with its own TERMINAL_STATUSES
 * check) — a paid or cancelled invoice never offers a "choose how to pay" form. */
function SettledNotice({ label }: { label: string }) {
  return (
    <p className="mt-5 rounded-lg border border-[#E5E7EB] bg-surface-muted px-4 py-6 text-center text-sm font-medium text-ink-strong">
      {label}
    </p>
  );
}

/**
 * The "Banner" layout's header: logo and name side by side in a full-width
 * colour strip. Distinct from CenteredHeader below (logo above name, both
 * centered) — before this, the two rendered near-identically because this
 * used the same stacked/centered markup Centered does, which is what made
 * "Banner" look like it had no layout of its own.
 */
function BrandBanner({
  brand,
  themeColor,
  logoSrc,
}: {
  brand: Brand;
  themeColor: string;
  logoSrc: string | null;
}) {
  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="flex items-center gap-4 rounded-t-2xl px-6 py-8"
    >
      <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/20 text-lg font-bold text-white">
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoSrc} alt="" className="h-full w-full object-cover" />
        ) : (
          initialOf(brand.displayName)
        )}
      </span>
      <span className="text-2xl font-bold text-white">{brand.displayName}</span>
    </div>
  );
}

/** The "Centered" layout's header: a short colour bar behind the logo, the
 * logo overlapping its bottom edge, name below on the plain surface — a
 * cover-photo/profile-picture arrangement, distinct from Banner's full-height
 * row and from a flat white header. */
function CenteredHeader({
  brand,
  themeColor,
  logoSrc,
}: {
  brand: Brand;
  themeColor: string;
  logoSrc: string | null;
}) {
  return (
    <div className="flex flex-col items-center">
      <div style={{ backgroundColor: themeColor }} className="h-16 w-full rounded-t-2xl" />
      <span
        style={{ backgroundColor: logoSrc ? undefined : themeColor }}
        className="-mt-8 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full
                   border-4 border-white text-lg font-bold text-white shadow-sm"
      >
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoSrc} alt="" className="h-full w-full object-cover" />
        ) : (
          initialOf(brand.displayName)
        )}
      </span>
      <span className="mt-2 px-6 text-lg font-bold text-ink-strong">{brand.displayName}</span>
    </div>
  );
}

/** The live preview: switches structure by layout, and by device narrows to
 * a single column — the split layout has nowhere to put a second column on
 * a phone screen, so it stacks instead. */
function PreviewBody({
  brand,
  themeColor,
  accentColor,
  layout,
  device,
  logoSrc,
  method,
  onMethodChange,
  invoice,
}: {
  brand: Brand;
  themeColor: string;
  accentColor: string;
  layout: PaymentPageLayout;
  device: 'web' | 'mobile';
  logoSrc: string | null;
  method: MethodKey;
  onMethodChange: (key: MethodKey) => void;
  invoice: PaymentPagePreviewInvoice | null;
}) {
  // A settled (paid/cancelled) invoice, or none at all, gets no payment
  // form — same rule the real hosted payment page enforces server-side.
  const paymentForm = invoice?.isSettled ? (
    <SettledNotice label={invoice.settledLabel ?? 'This invoice has been paid.'} />
  ) : (
    <>
      <MethodGrid selected={method} onSelect={onMethodChange} accentColor={accentColor} />
      {method === 'card' ? (
        <CardDetailsForm />
      ) : (
        <p className="mt-5 rounded-lg border border-dashed border-[#E5E7EB] bg-surface-muted px-4 py-6 text-center text-sm text-ink-muted">
          You will be redirected to complete payment via{' '}
          {METHODS.find((m) => m.key === method)?.label}.
        </p>
      )}
      <PayButton
        accentColor={accentColor}
        amountLabel={invoice?.amountLabel ?? SAMPLE_PREVIEW.amountLabel}
      />
    </>
  );

  if (layout === 'SPLIT') {
    return (
      <div className={`grid ${device === 'web' ? 'sm:grid-cols-2' : ''}`}>
        <div style={{ backgroundColor: themeColor }} className="flex flex-col gap-6 p-6">
          <div className="flex items-center gap-3 border-b border-white/20 pb-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/20 text-sm font-bold text-white">
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                initialOf(brand.displayName)
              )}
            </span>
            <span className="text-lg font-bold text-white">{brand.displayName}</span>
          </div>
          <InvoiceSummary invoice={invoice} light />
        </div>
        <div className="p-6">{paymentForm}</div>
      </div>
    );
  }

  return (
    <>
      {layout === 'BANNER' ? (
        <BrandBanner brand={brand} themeColor={themeColor} logoSrc={logoSrc} />
      ) : (
        <CenteredHeader brand={brand} themeColor={themeColor} logoSrc={logoSrc} />
      )}
      <div className="p-6">
        <InvoiceSummary invoice={invoice} centered={layout === 'CENTERED'} />
        <div className="mt-6">{paymentForm}</div>
      </div>
    </>
  );
}

export function PaymentPageEditor({
  brand,
  activeSub,
  display,
  previewInvoice,
}: {
  brand: Brand;
  /** Rendered inside the Preview column's own top row rather than as a
   * separate row above the whole card — see BrandingSubTabs' call site
   * below for why. */
  activeSub: BrandingSubTab;
  display: PaymentPageDisplaySettings;
  /** The brand's actual most recent invoice, or null if it has none yet —
   * see PaymentPagePreviewInvoice. Never fabricated. */
  previewInvoice: PaymentPagePreviewInvoice | null;
}) {
  const action = savePaymentPageDisplayAction.bind(null, brand);
  const [state, formAction] = useActionState(action, initialState);

  const [themeColor, setThemeColor] = useState(brand.themeColor);
  const [accentColor, setAccentColor] = useState(display.accentColor);
  const [layout, setLayout] = useState<PaymentPageLayout>(display.paymentPageLayout);
  const [device, setDevice] = useState<'web' | 'mobile'>('web');
  const [method, setMethod] = useState<MethodKey>('card');

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoSrc = logoPreview ?? brand.logoUrl;

  // Collapsible sections default open — collapsing just hides the fields,
  // it never discards a change already made while open.
  const [brandElementsOpen, setBrandElementsOpen] = useState(true);
  const [pageLayoutOpen, setPageLayoutOpen] = useState(true);

  const layoutGroupId = useId();

  function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    setLogoPreview(URL.createObjectURL(file));
  }

  return (
    <form
      action={formAction}
      className="mt-4 flex w-fit flex-col divide-y divide-[#E5E7EB] overflow-hidden rounded-2xl
                 border border-[#E5E7EB] bg-white shadow-sm lg:flex-row lg:divide-x lg:divide-y-0"
    >
      <input type="hidden" name="themeColor" value={themeColor} />
      <input type="hidden" name="accentColor" value={accentColor} />
      <input type="hidden" name="paymentPageLayout" value={layout} />

      <section className="w-[350px] shrink-0 p-6">
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
            <ColourField label="Accent colour" value={accentColor} onChange={setAccentColor} />
          </div>
        )}

        <div className="mt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-ink-strong">Page layout</p>
              <p className="mt-1 text-sm text-ink-muted">
                Choose how your payment page is presented to customers.
              </p>
            </div>
            <CollapseToggle
              open={pageLayoutOpen}
              onToggle={() => setPageLayoutOpen((open) => !open)}
              label="Page layout"
            />
          </div>

          {pageLayoutOpen && (
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
                    {selected && <Check className="h-4 w-4 shrink-0 text-ink-strong" aria-hidden />}
                  </button>
                );
              })}
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
          <div
            role="radiogroup"
            aria-label="Preview device"
            className="inline-flex rounded-lg border border-[#E5E7EB] bg-white p-1"
          >
            {(
              [
                { key: 'web' as const, label: 'Web', icon: Monitor },
                { key: 'mobile' as const, label: 'Mobile', icon: Smartphone },
              ] satisfies { key: 'web' | 'mobile'; label: string; icon: typeof Monitor }[]
            ).map(({ key, label, icon: Icon }) => {
              const selected = key === device;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDevice(key)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    selected ? 'bg-black text-white' : 'text-ink-muted hover:text-ink-strong'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={`mt-4 overflow-hidden border border-[#E5E7EB] bg-white shadow-sm transition-[max-width] ${
            layout === 'SPLIT' && device === 'web' ? 'rounded-l-2xl' : 'rounded-2xl'
          } ${device === 'mobile' ? 'mx-auto w-full max-w-[340px]' : 'max-w-none'}`}
        >
          <PreviewBody
            brand={brand}
            themeColor={themeColor}
            accentColor={accentColor}
            layout={layout}
            device={device}
            logoSrc={logoSrc}
            method={method}
            onMethodChange={setMethod}
            invoice={previewInvoice}
          />
        </div>
      </section>
    </form>
  );
}
