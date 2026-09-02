/**
 * The invoice receipt email's HTML body (FR-MAIL).
 *
 * Lives here rather than in the API because it is pure, because both the
 * real send and the test send render through it, and because the admin
 * editor's preview is written against the same three layouts — a layout
 * added here is a layout the preview must grow too, and having them in one
 * package makes that obvious rather than a thing to remember.
 *
 * This file and PreviewBody (apps/admin/.../email-receipt-editor.tsx) are two
 * renderers of one design, so every visible element here has a counterpart
 * there: the sender line under the brand name, the colour band above HERO and
 * CLASSIC, the emphasised variables, the full-width button and the bordered
 * "Invoice summary" card. A change to one is a change to both; a merchant
 * reads the preview as a promise about their customer's inbox.
 *
 * Table-based markup with inline styles throughout: Gmail strips <style>
 * blocks, Outlook renders through Word, and neither supports flexbox or
 * grid. This is deliberately not how the rest of the codebase writes markup.
 */

import type { EmailReceiptLayout } from './email-receipt-layout.js';

export interface EmailReceiptHtmlInput {
  /** Chooses the header treatment. The body below it is identical in all
   * three — only the brand presentation differs. */
  readonly layout: EmailReceiptLayout;
  readonly brandName: string;
  /** The brand colour: header band and, on HERO, the whole header block. */
  readonly themeColor: string;
  /** The accent colour: the "View & Pay Invoice" button, and MINIMAL's rule
   * above the subject. */
  readonly accentColor: string;
  /** Rendered above the brand name. `cid:` for an inline attachment, or an
   * absolute URL. Null falls back to the brand's first initial in a circle,
   * exactly as the editor's preview does. */
  readonly logoSrc: string | null;
  /** The From address recipients actually see, echoed under the brand name
   * the way the preview shows it. The mail client shows this too, but the
   * preview has no From line of its own, so the header carries it there. */
  readonly senderAddress: string;
  /** Already substituted — the same string used as the message subject, and
   * repeated as the body's heading so the email reads as a document. */
  readonly subject: string;
  /** Already substituted. Blank lines separate paragraphs. */
  readonly body: string;
  readonly variables: {
    readonly invoiceNumber: string;
    readonly amountDue: string;
    readonly dueDate: string;
    /** Neither appears in the summary table. They are carried so the body can
     * emphasise them, which is the only reason this renderer knows them. */
    readonly customerName?: string;
    readonly brandName?: string;
  };
  readonly linkUrl: string;
  /** Overrides the brand name in the header — the test send says "Test send"
   * there so a merchant can never mistake one for a real invoice mail. */
  readonly badgeLabel?: string;
}

const FONT_STACK = '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
const BORDER = '#E2E8F0';
const TEXT = '#334155';
const MUTED = '#475569';
const STRONG = '#0F172A';
const SURFACE_MUTED = '#F8FAFC';
const SUMMARY_HEADER_BG = '#F1F5F9';

export function renderEmailReceiptHtml(input: EmailReceiptHtmlInput): string {
  const brandName = escapeHtml(input.badgeLabel ?? input.brandName);
  const theme = escapeHtml(input.themeColor);
  const accent = escapeHtml(input.accentColor);
  const marks = emphasisValues(input);

  const paragraphs =
    input.body
      .split('\n')
      .map((line) =>
        line.trim()
          ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${TEXT};">${emphasise(line, marks, `font-weight:700;color:${STRONG};`)}</p>`
          : '',
      )
      .filter(Boolean)
      .join('\n        ') || '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:${SURFACE_MUTED};font-family:${FONT_STACK};">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
      ${header(input, brandName, theme)}
      <tr><td style="padding:24px;">
        ${input.layout === 'MINIMAL' ? `<div style="width:40px;height:6px;border-radius:3px;background:${theme};margin:0 0 16px;"></div>` : ''}
        <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:${STRONG};">${emphasise(input.subject, marks, `color:${theme};`)}</p>
        ${paragraphs}
        <a href="${escapeHtml(input.linkUrl)}" style="display:block;width:100%;box-sizing:border-box;margin-top:20px;background:${accent};color:#FFFFFF;text-decoration:none;padding:14px 20px;border-radius:8px;font-size:14px;font-weight:700;text-align:center;">
          View &amp; Pay Invoice
        </a>
        ${summary(input)}
      </td></tr>
    </table>
  </body>
</html>`;
}

/**
 * The one thing the three layouts actually disagree about.
 *
 * HERO fills the header with the brand colour and centres the mark over the
 * name; CLASSIC keeps a white header row under the same thin colour band;
 * MINIMAL drops the band entirely and lets the rule inside the body do the
 * only colouring. Mirrors PreviewBody in the admin editor.
 */
function header(input: EmailReceiptHtmlInput, brandName: string, theme: string): string {
  // HERO and CLASSIC both get it; the preview draws it above HERO's block
  // rather than behind it, so the coloured header reads as deliberate.
  const band =
    input.layout === 'MINIMAL'
      ? ''
      : `<tr><td style="background:${theme};font-size:0;line-height:0;height:6px;">&nbsp;</td></tr>`;

  if (input.layout === 'HERO') {
    return `${band}
      <tr><td style="background:${theme};padding:32px 24px;text-align:center;">
        ${logoMark(input, 60, 'rgba(255,255,255,0.2)', 'border:3px solid #FFFFFF;')}
        <div style="margin-top:8px;font-size:18px;font-weight:700;color:#FFFFFF;">${brandName}</div>
        <div style="margin-top:2px;font-size:12px;color:rgba(255,255,255,0.8);">${escapeHtml(input.senderAddress)}</div>
      </td></tr>`;
  }

  return `${band}
      <tr><td style="padding:20px 24px;border-bottom:1px solid ${BORDER};">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:12px;">${logoMark(input, 48, undefined, `border:1px solid ${BORDER};`)}</td>
          <td>
            <div style="font-size:16px;font-weight:700;color:${STRONG};">${brandName}</div>
            <div style="margin-top:2px;font-size:14px;color:${MUTED};">${escapeHtml(input.senderAddress)}</div>
          </td>
        </tr></table>
      </td></tr>`;
}

/** The bordered "Invoice summary" card — a titled box in the preview, so a
 * titled box here rather than the bare rows this used to emit. */
function summary(input: EmailReceiptHtmlInput): string {
  const row = (label: string, value: string): string =>
    `<tr>
            <td style="padding:10px 16px;border-top:1px solid ${BORDER};font-size:14px;color:${MUTED};">${label}</td>
            <td style="padding:10px 16px;border-top:1px solid ${BORDER};font-size:14px;font-weight:700;color:${STRONG};text-align:right;">${escapeHtml(value)}</td>
          </tr>`;

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:24px;border:1px solid ${BORDER};border-radius:8px;border-collapse:separate;overflow:hidden;">
          <tr><td colspan="2" style="background:${SUMMARY_HEADER_BG};padding:10px 16px;font-size:14px;font-weight:700;color:${STRONG};">Invoice summary</td></tr>
          ${row('Invoice number', input.variables.invoiceNumber)}
          ${row('Amount due', input.variables.amountDue)}
          ${row('Due date', input.variables.dueDate)}
        </table>`;
}

/** The logo, or the brand's first initial on a coloured disc when there is
 * none — the same fallback the editor's preview draws. */
function logoMark(
  input: EmailReceiptHtmlInput,
  size: number,
  fallbackBg?: string,
  border = '',
): string {
  if (input.logoSrc) {
    return `<img src="${escapeHtml(input.logoSrc)}" alt="" width="${size}" height="${size}" style="display:inline-block;width:${size}px;height:${size}px;border-radius:${size}px;object-fit:cover;${border}" />`;
  }

  const background = fallbackBg ?? escapeHtml(input.themeColor);
  const initial = escapeHtml(initialOf(input.badgeLabel ?? input.brandName));
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;"><tr>
            <td width="${size}" height="${size}" align="center" valign="middle" style="width:${size}px;height:${size}px;background:${background};border-radius:${size}px;color:#FFFFFF;font-size:${Math.round(size / 2.5)}px;font-weight:700;font-family:${FONT_STACK};${border}">${initial}</td>
          </tr></table>`;
}

/**
 * The values the body and subject emphasise, longest first so that a value
 * containing another (a customer named after their own invoice, say) wins
 * over the shorter one instead of being cut in half by it.
 *
 * Single characters are dropped: a one-letter name would otherwise bold every
 * one of that letter in the email.
 */
function emphasisValues(input: EmailReceiptHtmlInput): readonly string[] {
  const { invoiceNumber, amountDue, dueDate, customerName, brandName } = input.variables;
  return [invoiceNumber, amountDue, dueDate, customerName, brandName]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 1)
    .sort((a, b) => b.length - a.length);
}

/**
 * Emphasises the substituted variable values inside an already-substituted
 * line.
 *
 * The editor's preview does this from the raw template, so it can bold
 * exactly what a variable inserted and never a coincidental match. That is
 * not available here: on a real send the merchant may have edited the body
 * freely in the compose modal, so by the time this runs there is no template
 * left to segment — only final text. Matching on the values is what survives
 * that edit, at the cost of also emphasising text that happens to equal one
 * of them.
 */
function emphasise(line: string, values: readonly string[], style: string): string {
  if (values.length === 0) return escapeHtml(line);

  const pattern = new RegExp(`(${values.map(escapeRegExp).join('|')})`, 'g');
  return line
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) =>
      values.includes(part)
        ? `<strong style="${style}">${escapeHtml(part)}</strong>`
        : escapeHtml(part),
    )
    .join('');
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
