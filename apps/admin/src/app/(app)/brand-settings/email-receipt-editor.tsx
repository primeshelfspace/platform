'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Send } from 'lucide-react';
import type { Brand, EmailReceiptLayout, EmailReceiptSettings } from '@/lib/api';
import {
  saveEmailReceiptSettingsAction,
  sendTestEmailAction,
  type EmailReceiptState,
  type SendTestEmailState,
} from './actions';
import type { PaymentPagePreviewInvoice } from './payment-page-editor';
import { BrandingSubTabs, type BrandingSubTab } from './tabs';

const initialSaveState: EmailReceiptState = {};
const initialSendState: SendTestEmailState = {};

/** Same numbers the Payment Page preview falls back to when a brand has no
 * invoices yet — one sample identity across every preview in this app,
 * never a different fake per screen. */
const SAMPLE_PREVIEW = {
  customerName: 'Harborline Distributors',
  number: 'INV-3021',
  amountLabel: '$4,820.00',
  dueDateLabel: 'Aug 26, 2026',
};

const LAYOUTS: readonly { key: EmailReceiptLayout; title: string; description: string }[] = [
  {
    key: 'CLASSIC',
    title: 'Classic',
    description: 'Logo and brand name in a row, plain background',
  },
  { key: 'HERO', title: 'Hero', description: 'Full-width colour header, centred logo and name' },
  { key: 'MINIMAL', title: 'Minimal', description: 'Clean, no header colour — logo mark only' },
];

const VARIABLES: readonly { token: string; label: string }[] = [
  { token: '{{brand_name}}', label: 'Brand name' },
  { token: '{{customer_name}}', label: 'Customer name' },
  { token: '{{invoice_number}}', label: 'Invoice number' },
  { token: '{{amount_due}}', label: 'Amount due' },
  { token: '{{due_date}}', label: 'Due date' },
];

function initialOf(value: string): string {
  return (value.trim().charAt(0) || '?').toUpperCase();
}

/** A cosmetic-only sender address shown under the brand name in the preview
 * (matching how the email will actually appear in a customer's inbox) — no
 * such field exists on Brand yet, so this derives one from the display name
 * rather than sending real mail from it. */
function noReplyAddressFor(displayName: string): string {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `noreply@${slug || 'brand'}.com`;
}

type TemplateVariables = {
  brandName: string;
  customerName: string;
  invoiceNumber: string;
  amountDue: string;
  dueDate: string;
};

const VARIABLE_TOKEN_RE =
  /(\{\{brand_name\}\}|\{\{customer_name\}\}|\{\{invoice_number\}\}|\{\{amount_due\}\}|\{\{due_date\}\})/g;

/** Splits one line of a raw (un-substituted) template into literal text and
 * variable segments, so the preview can bold exactly the parts a variable
 * inserted — never any coincidental text that happens to match. */
function segmentsForLine(
  line: string,
  variables: TemplateVariables,
): { text: string; isVariable: boolean }[] {
  return line
    .split(VARIABLE_TOKEN_RE)
    .filter((part) => part.length > 0)
    .map((part) => {
      switch (part) {
        case '{{brand_name}}':
          return { text: variables.brandName, isVariable: true };
        case '{{customer_name}}':
          return { text: variables.customerName, isVariable: true };
        case '{{invoice_number}}':
          return { text: variables.invoiceNumber, isVariable: true };
        case '{{amount_due}}':
          return { text: variables.amountDue, isVariable: true };
        case '{{due_date}}':
          return { text: variables.dueDate, isVariable: true };
        default:
          return { text: part, isVariable: false };
      }
    });
}

/** Substitutes the same five variables BrandSettingsService.sendEmailReceiptTest
 * substitutes server-side — kept in exact sync so the preview never shows
 * something other than what a test send will actually contain. */
function substitute(
  template: string,
  vars: {
    brandName: string;
    customerName: string;
    invoiceNumber: string;
    amountDue: string;
    dueDate: string;
  },
): string {
  return template
    .replaceAll('{{brand_name}}', vars.brandName)
    .replaceAll('{{customer_name}}', vars.customerName)
    .replaceAll('{{invoice_number}}', vars.invoiceNumber)
    .replaceAll('{{amount_due}}', vars.amountDue)
    .replaceAll('{{due_date}}', vars.dueDate);
}

/** The circular chevron button that collapses/expands a section. Identical
 * to PaymentPageEditor's own CollapseToggle — duplicated rather than shared
 * across the two editor files to keep each independently safe to change. */
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
 * Identical to PaymentPageEditor's own ColourField. */
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

/** The rendered email — logo/name arranged per layout, subject as a heading,
 * body with variables substituted, a fixed "View & Pay Invoice" button and
 * invoice-summary table that are never part of the editable template (the
 * real send always appends the same two, so the preview must match). */
function PreviewBody({
  brand,
  themeColor,
  layout,
  logoSrc,
  subjectTemplate,
  bodyTemplate,
  variables,
  invoiceLabel,
  viewUrl,
}: {
  brand: Brand;
  /** Drives the top border strip, the logo avatar's fallback background, and
   * the brand name inside the subject line — all three pick it up, so
   * changing one colour in Brand Elements re-colours all three at once. */
  themeColor: string;
  layout: EmailReceiptLayout;
  logoSrc: string | null;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: TemplateVariables;
  invoiceLabel: { number: string; amountDue: string; dueDate: string };
  viewUrl: string | null;
}) {
  const senderAddress = noReplyAddressFor(brand.displayName);

  const avatar = (size: string, fallbackBg?: string) => (
    <span
      className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white`}
      style={{ backgroundColor: logoSrc ? undefined : (fallbackBg ?? themeColor) }}
    >
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt="" className="h-full w-full object-cover" />
      ) : (
        initialOf(brand.displayName)
      )}
    </span>
  );

  return (
    <>
      {/* The one visual cue that this is a live send rather than a plain
          document. Hero and Classic both get the full-width bar spanning
          the very top of the card (Classic's sits above its avatar/name
          header row instead of behind it); Minimal stays bare per its own
          "no header colour" description, with a short accent bar below its
          header instead, right above the subject line. */}
      {(layout === 'HERO' || layout === 'CLASSIC') && (
        <div style={{ backgroundColor: themeColor }} className="h-1.5 w-full" aria-hidden />
      )}

      {layout === 'HERO' ? (
        <div
          style={{ backgroundColor: themeColor }}
          className="flex flex-col items-center gap-2 px-6 py-8"
        >
          {avatar('h-14 w-14', 'rgba(255,255,255,0.2)')}
          <span className="text-lg font-bold text-white">{brand.displayName}</span>
          <span className="text-xs text-white/80">{senderAddress}</span>
        </div>
      ) : (
        <div className="flex items-center gap-3 border-b border-[#E5E7EB] px-6 py-5">
          {avatar('h-10 w-10')}
          <span>
            <span className="block text-base font-bold text-ink-strong">{brand.displayName}</span>
            <span className="block text-sm text-ink-subtle">{senderAddress}</span>
          </span>
        </div>
      )}

      <div className="p-6">
        {layout === 'MINIMAL' && (
          <div
            style={{ backgroundColor: themeColor }}
            className="mb-4 h-1.5 w-10 rounded-full"
            aria-hidden
          />
        )}
        <p className="text-base font-bold text-ink-strong">
          {segmentsForLine(subjectTemplate, variables).map((segment, index) =>
            segment.isVariable ? (
              <span key={index} style={{ color: themeColor }}>
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
        <div className="mt-3 space-y-3 text-sm text-ink-muted">
          {bodyTemplate.split('\n').map((line, index) =>
            line.trim() ? (
              <p key={index}>
                {segmentsForLine(line, variables).map((segment, segmentIndex) =>
                  segment.isVariable ? (
                    <strong key={segmentIndex} className="font-bold text-ink-strong">
                      {segment.text}
                    </strong>
                  ) : (
                    <span key={segmentIndex}>{segment.text}</span>
                  ),
                )}
              </p>
            ) : (
              <div key={index} className="h-1" aria-hidden />
            ),
          )}
        </div>

        <a
          href={viewUrl ?? '#'}
          onClick={(event) => {
            if (!viewUrl) event.preventDefault();
          }}
          className="mt-5 block w-full rounded-lg bg-black px-5 py-3.5 text-center text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          View &amp; Pay Invoice
        </a>

        <div className="mt-6 overflow-hidden rounded-lg border border-[#E5E7EB]">
          <p className="bg-surface-muted px-4 py-2.5 text-sm font-bold text-ink-strong">
            Invoice summary
          </p>
          <dl className="divide-y divide-[#E5E7EB] text-sm">
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-ink-muted">Invoice number</dt>
              <dd className="font-bold text-ink-strong">{invoiceLabel.number}</dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-ink-muted">Amount due</dt>
              <dd className="font-bold text-ink-strong">{invoiceLabel.amountDue}</dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-ink-muted">Due date</dt>
              <dd className="font-bold text-ink-strong">{invoiceLabel.dueDate}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Legal footer — links to the same public /terms and /privacy pages
          linked from the sign-up form (see apps/admin/src/app/terms and
          .../privacy), not brand-specific. This preview is a mockup for
          editing subject/body/layout, not a byte-for-byte match of the real
          send (see renderEmailReceiptHtml in brand-settings.service.ts,
          which is a separate, simpler template) — so the footer only needs
          to exist here for now. */}
      <div className="border-t border-[#E5E7EB] bg-surface-muted px-6 py-6 text-center text-sm text-ink-muted">
        {brand.displayName} ·{' '}
        <a href="/terms" className="underline hover:text-ink-strong">
          Terms &amp; Conditions
        </a>{' '}
        ·{' '}
        <a href="/privacy" className="underline hover:text-ink-strong">
          Privacy Policy
        </a>
      </div>
    </>
  );
}

export function EmailReceiptEditor({
  brand,
  activeSub,
  settings,
  accentColor: initialAccentColor,
  previewInvoice,
  userEmail,
}: {
  brand: Brand;
  /** Rendered inside the Preview column's own top row — see PaymentPageEditor's
   * identical treatment for why it isn't a separate row above the card. */
  activeSub: BrandingSubTab;
  settings: EmailReceiptSettings;
  /** Same field Payment Page edits — there is only one accent colour per
   * brand; Brand Elements here is a second entry point onto it. */
  accentColor: string;
  previewInvoice: PaymentPagePreviewInvoice | null;
  /** "Send Test Email" always sends to the signed-in user's own address —
   * nothing to type, nowhere to mistype it. Null only if that lookup itself
   * failed, in which case the button disables rather than sending nowhere. */
  userEmail: string | null;
}) {
  const saveAction = saveEmailReceiptSettingsAction.bind(null, brand);
  const [saveState, saveFormAction, savePending] = useActionState(saveAction, initialSaveState);

  const sendAction = sendTestEmailAction.bind(null, brand);
  const [sendState, sendFormAction, sendPending] = useActionState(sendAction, initialSendState);

  const [themeColor, setThemeColor] = useState(brand.themeColor);
  const [accentColor, setAccentColor] = useState(initialAccentColor);
  const [layout, setLayout] = useState<EmailReceiptLayout>(settings.emailReceiptLayout);
  const [subject, setSubject] = useState(settings.emailReceiptSubject);
  const [body, setBody] = useState(settings.emailReceiptBody);

  // Last-known-persisted snapshot, re-seeded from whatever was just
  // submitted the moment a save succeeds (see the effect below) — comparing
  // the live state above against this is what drives the Save Changes
  // button's visibility, matching the reference: no button when nothing has
  // changed since the last save.
  const [savedValues, setSavedValues] = useState({
    themeColor: brand.themeColor,
    accentColor: initialAccentColor,
    layout: settings.emailReceiptLayout,
    subject: settings.emailReceiptSubject,
    body: settings.emailReceiptBody,
  });
  const [logoDirty, setLogoDirty] = useState(false);
  // Layout is deliberately excluded here: picking Hero or Minimal previews
  // it immediately without asking for an explicit save, the same way
  // Classic (the already-saved default) never shows the button either. It's
  // still submitted as part of the form whenever something else does
  // trigger a save, so a layout pick is never silently lost — it just rides
  // along with the next real change instead of demanding its own.
  const isDirty =
    logoDirty ||
    themeColor !== savedValues.themeColor ||
    accentColor !== savedValues.accentColor ||
    subject !== savedValues.subject ||
    body !== savedValues.body;

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoSrc = logoPreview ?? brand.logoUrl;
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [brandElementsOpen, setBrandElementsOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [contentOpen, setContentOpen] = useState(false);

  const layoutGroupId = useId();
  const testFormId = useId();
  const saveFormId = useId();

  function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    setLogoPreview(URL.createObjectURL(file));
    setLogoDirty(true);
  }

  function handleDiscard() {
    setThemeColor(savedValues.themeColor);
    setAccentColor(savedValues.accentColor);
    setLayout(savedValues.layout);
    setSubject(savedValues.subject);
    setBody(savedValues.body);
    setLogoPreview(null);
    setLogoDirty(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // On a successful save, whatever was just submitted becomes the new
  // baseline, which is what makes the button disappear again.
  useEffect(() => {
    if (!saveState.success) return;
    setSavedValues({ themeColor, accentColor, layout, subject, body });
    setLogoDirty(false);
    // Intentionally keyed on `saveState` alone: this should fire once per
    // successful dispatch, using whichever values were current at that
    // point, not re-fire on every subsequent keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState]);

  /** Inserts a variable token at the textarea's cursor (or appends it if the
   * textarea hasn't been focused yet) rather than always appending — typing
   * `{{amount_due}}` mid-sentence should land where the cursor actually is. */
  function insertVariable(token: string) {
    const el = bodyRef.current;
    if (!el) {
      setBody((current) => `${current}${token}`);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const variables = previewInvoice
    ? {
        brandName: brand.displayName,
        customerName: previewInvoice.customerName,
        invoiceNumber: previewInvoice.number,
        amountDue: previewInvoice.amountLabel,
        dueDate: previewInvoice.dueDateLabel,
      }
    : {
        brandName: brand.displayName,
        customerName: SAMPLE_PREVIEW.customerName,
        invoiceNumber: SAMPLE_PREVIEW.number,
        amountDue: SAMPLE_PREVIEW.amountLabel,
        dueDate: SAMPLE_PREVIEW.dueDateLabel,
      };

  const renderedSubject = substitute(subject, variables);
  const renderedBody = substitute(body, variables);

  return (
    <>
      <div
        className="mt-4 flex w-fit flex-col divide-y divide-[#E5E7EB] overflow-hidden rounded-2xl
                 border border-[#E5E7EB] bg-white shadow-sm lg:flex-row lg:divide-x lg:divide-y-0"
      >
        <section className="w-[350px] shrink-0 p-6">
          <form id={saveFormId} action={saveFormAction}>
            <input type="hidden" name="themeColor" value={themeColor} />
            <input type="hidden" name="accentColor" value={accentColor} />
            <input type="hidden" name="emailReceiptLayout" value={layout} />
            <input type="hidden" name="emailReceiptSubject" value={subject} />
            <input type="hidden" name="emailReceiptBody" value={body} />

            {/* Brand Elements / Email Layout / Email Content used to just be
              mt-6-spaced with no line between them — only "Send a test
              email" below got a border, from its own separate <form>. This
              divide-y draws the same light line under each of the three
              here too, matching the reference design. */}
            <div className="divide-y divide-[#E5E7EB]">
              <div className="pb-6">
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
                    <ColourField
                      label="Accent colour"
                      value={accentColor}
                      onChange={setAccentColor}
                    />
                  </div>
                )}
              </div>

              <div className="py-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-ink-strong">Email Layout</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      Choose how your email receipts are structured and presented.
                    </p>
                  </div>
                  <CollapseToggle
                    open={layoutOpen}
                    onToggle={() => setLayoutOpen((open) => !open)}
                    label="Email Layout"
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
                            <span className="block text-sm font-semibold text-ink-strong">
                              {title}
                            </span>
                            <span className="block text-xs text-ink-muted">{description}</span>
                          </span>
                          {selected && (
                            <Check className="h-5 w-5 shrink-0 text-ink-strong" aria-hidden />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-ink-strong">Email Content</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      Customise the subject and body of your email receipts.
                    </p>
                  </div>
                  <CollapseToggle
                    open={contentOpen}
                    onToggle={() => setContentOpen((open) => !open)}
                    label="Email Content"
                  />
                </div>

                {contentOpen && (
                  <div className="mt-4 space-y-4">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-ink-strong">
                        Subject
                      </span>
                      <input
                        value={subject}
                        onChange={(event) => setSubject(event.target.value)}
                        className="h-10 w-full rounded-lg border border-[#D4D4D4] bg-white px-3 text-sm text-slate-900
                               shadow-[0_1px_1px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-ink-strong">Body</span>
                      <textarea
                        ref={bodyRef}
                        value={body}
                        onChange={(event) => setBody(event.target.value)}
                        rows={8}
                        className="w-full rounded-lg border border-[#D4D4D4] bg-white px-3 py-2 text-sm text-slate-900
                               shadow-[0_1px_1px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                      />
                    </label>

                    <div>
                      <p className="text-xs font-medium text-ink-muted">
                        Click a variable to insert it at the cursor position in the body.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {VARIABLES.map((variable) => (
                          <button
                            key={variable.token}
                            type="button"
                            onClick={() => insertVariable(variable.token)}
                            className="rounded-full border border-[#D1D5DB] bg-white px-3 py-1 font-mono text-xs
                                   text-ink-strong transition-colors hover:bg-slate-50"
                          >
                            {variable.token}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {saveState.error && (
              <p
                role="alert"
                className="mt-6 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {saveState.error}
              </p>
            )}
            {saveState.success && (
              <p className="mt-6 rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Saved.
              </p>
            )}

            {/* Save/Discard live in the sticky bar below, outside this card —
              see the comment there for why. */}
          </form>

          {/* A separate <form> — HTML forbids nesting one inside Save Changes'
            form above, and "send a test" is a genuinely different submit
            (it never touches saved settings; see sendTestEmailAction). The
            compact button in the preview panel submits this same form via
            its `form` attribute rather than duplicating the fields. No email
            field to fill in — it always goes to the signed-in user's own
            address, via the hidden "to" field below. */}
          <form
            id={testFormId}
            action={sendFormAction}
            className="mt-6 border-t border-[#E5E7EB] pt-6"
          >
            <input type="hidden" name="to" value={userEmail ?? ''} />
            <input type="hidden" name="emailReceiptSubject" value={renderedSubject} />
            <input type="hidden" name="emailReceiptBody" value={renderedBody} />
            <p className="text-sm font-bold text-ink-strong">Send a test email</p>
            <p className="mt-1 text-sm text-ink-muted">
              Preview exactly what your customers will receive.
            </p>
            <button
              type="submit"
              disabled={sendPending || !userEmail}
              title={userEmail ? undefined : 'Could not find your account email'}
              className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg bg-black px-4 text-sm font-bold
                       text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#94A3B8]"
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              {sendPending ? 'Sending…' : 'Send Test Email'}
            </button>
            {sendState.error && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {sendState.error}
              </p>
            )}
            {sendState.success && (
              <p className="mt-2 text-sm text-emerald-700">Test email sent to {userEmail}.</p>
            )}
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
              type="submit"
              form={testFormId}
              disabled={sendPending || !userEmail}
              title={userEmail ? undefined : 'Could not find your account email'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5
                       text-xs font-semibold text-ink-strong transition-colors hover:bg-slate-50
                       disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              {sendPending ? 'Sending…' : 'Send Test Email'}
            </button>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
            <PreviewBody
              brand={brand}
              themeColor={themeColor}
              layout={layout}
              logoSrc={logoSrc}
              subjectTemplate={subject}
              bodyTemplate={body}
              variables={variables}
              invoiceLabel={{
                number: variables.invoiceNumber,
                amountDue: variables.amountDue,
                dueDate: variables.dueDate,
              }}
              viewUrl={previewInvoice?.viewUrl ?? null}
            />
          </div>
        </section>
      </div>

      {/* Bottom-right action bar — only appears once there's something to
        save or discard, and stays out of the layout entirely otherwise. See
        BrandDetailsForm's own identical bar for the full rationale (sticky
        vs fixed, the -mx-6/-mx-10 bleed matching PageContainer's own
        padding). The Save button reaches the actual <form> above purely via
        its `form` attribute — proven to work correctly in this app already
        (the compact "Send Test Email" button above does the same). */}
      {isDirty && (
        <div
          className="sticky bottom-0 z-10 -mx-6 mt-8 flex justify-end gap-3 border-t
                   border-[#E5E7EB] bg-surface px-6 py-4 sm:-mx-10 sm:px-10"
        >
          <button
            type="button"
            onClick={handleDiscard}
            disabled={savePending}
            className="rounded-[10px] border border-[#D4D4D4] bg-white px-6 py-3 text-sm font-bold
                   text-[#0F172A] transition-colors hover:bg-neutral-50
                   disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          >
            Discard
          </button>
          <button
            type="submit"
            form={saveFormId}
            disabled={savePending}
            className="rounded-[10px] bg-black px-6 py-3 text-sm font-bold text-white transition-colors
                   hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#94A3B8]
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          >
            {savePending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </>
  );
}
