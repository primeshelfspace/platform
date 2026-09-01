/**
 * The invoice receipt email's HTML body (FR-MAIL).
 *
 * Lives here rather than in the API because it is pure, because both the
 * real send and the test send render through it, and because the admin
 * editor's preview is written against the same three layouts — a layout
 * added here is a layout the preview must grow too, and having them in one
 * package makes that obvious rather than a thing to remember.
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
  /** Already substituted — the same string used as the message subject, and
   * repeated as the body's heading so the email reads as a document. */
  readonly subject: string;
  /** Already substituted. Blank lines separate paragraphs. */
  readonly body: string;
  readonly variables: {
    readonly invoiceNumber: string;
    readonly amountDue: string;
    readonly dueDate: string;
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

export function renderEmailReceiptHtml(input: EmailReceiptHtmlInput): string {
  const brandName = escapeHtml(input.badgeLabel ?? input.brandName);
  const theme = escapeHtml(input.themeColor);
  const accent = escapeHtml(input.accentColor);

  const paragraphs =
    input.body
      .split('\n')
      .map((line) =>
        line.trim()
          ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${TEXT};">${escapeHtml(line)}</p>`
          : '',
      )
      .filter(Boolean)
      .join('\n        ') || '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#F8FAFC;font-family:${FONT_STACK};">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
      ${header(input, brandName, theme)}
      <tr><td style="padding:32px;">
        ${input.layout === 'MINIMAL' ? `<div style="width:40px;height:6px;border-radius:3px;background:${theme};margin:0 0 16px;"></div>` : ''}
        <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#0F172A;">${escapeHtml(input.subject)}</p>
        ${paragraphs}
        <a href="${escapeHtml(input.linkUrl)}" style="display:inline-block;margin-top:12px;background:${accent};color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;font-size:15px;font-weight:600;">
          View &amp; Pay Invoice
        </a>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:24px;border-top:1px solid ${BORDER};padding-top:16px;font-size:13px;color:${MUTED};">
          <tr><td style="padding-top:16px;">Invoice number</td><td style="padding-top:16px;text-align:right;">${escapeHtml(input.variables.invoiceNumber)}</td></tr>
          <tr><td>Amount due</td><td style="text-align:right;">${escapeHtml(input.variables.amountDue)}</td></tr>
          <tr><td>Due date</td><td style="text-align:right;">${escapeHtml(input.variables.dueDate)}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/**
 * The one thing the three layouts actually disagree about.
 *
 * HERO fills the header with the brand colour and centres the mark over the
 * name; CLASSIC keeps a white header row under a thin colour band; MINIMAL
 * drops the band entirely and lets the accent rule inside the body do the
 * only colouring. Mirrors PreviewBody in the admin editor.
 */
function header(input: EmailReceiptHtmlInput, brandName: string, theme: string): string {
  const mark = logoMark(input, 40);

  if (input.layout === 'HERO') {
    return `<tr><td style="background:${theme};padding:32px 24px;text-align:center;">
        ${logoMark(input, 56, 'rgba(255,255,255,0.2)')}
        <div style="margin-top:8px;font-size:18px;font-weight:700;color:#FFFFFF;">${brandName}</div>
      </td></tr>`;
  }

  const band =
    input.layout === 'CLASSIC'
      ? `<tr><td style="background:${theme};font-size:0;line-height:0;height:6px;">&nbsp;</td></tr>`
      : '';

  return `${band}
      <tr><td style="padding:20px 24px;border-bottom:1px solid ${BORDER};">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:12px;">${mark}</td>
          <td style="font-size:16px;font-weight:700;color:#0F172A;">${brandName}</td>
        </tr></table>
      </td></tr>`;
}

/** The logo, or the brand's first initial on a coloured disc when there is
 * none — the same fallback the editor's preview draws. */
function logoMark(input: EmailReceiptHtmlInput, size: number, fallbackBg?: string): string {
  if (input.logoSrc) {
    return `<img src="${escapeHtml(input.logoSrc)}" alt="" width="${size}" height="${size}" style="display:inline-block;width:${size}px;height:${size}px;border-radius:${size}px;object-fit:cover;" />`;
  }

  const background = fallbackBg ?? escapeHtml(input.themeColor);
  const initial = escapeHtml(initialOf(input.badgeLabel ?? input.brandName));
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;"><tr>
            <td width="${size}" height="${size}" align="center" valign="middle" style="width:${size}px;height:${size}px;background:${background};border-radius:${size}px;color:#FFFFFF;font-size:${Math.round(size / 2.5)}px;font-weight:700;font-family:${FONT_STACK};">${initial}</td>
          </tr></table>`;
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
