import { z } from 'zod';
import {
  PAYMENT_METHODS,
  addressSchema,
  arrayQueryParam,
  basisPointsSchema,
  currencySchema,
  dateRangeSchema,
  decimalAmountStringSchema,
  emailSchema,
  hexColourSchema,
  idSchema,
  paginationSchema,
  phoneSchema,
  quantityStringSchema,
} from '@platform/kernel';
import { INVOICE_STATUSES } from './invoice-status.js';
import { PAYMENT_STATUSES } from './payment-status.js';
import { EMAIL_RECEIPT_LAYOUTS } from './email-receipt-layout.js';

export const brandSettingsSchema = z.object({
  invoicePrefix: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Z0-9-]+$/, 'prefix may contain A–Z, 0–9 and hyphens'),
  paymentTermsDays: z.number().int().min(0).max(365),
  defaultTaxRateBp: basisPointsSchema,
  cardFeeRateBp: basisPointsSchema,
  lateFeeRateBp: basisPointsSchema,
  partialPaymentEnabled: z.boolean(),
  reminderSchedule: z.array(z.number().int()).max(10),
});
export type BrandSettingsInput = z.infer<typeof brandSettingsSchema>;

/** FR-PAY-005: which methods the public payment page offers for this brand.
 * Deliberately separate from brandSettingsSchema above, which has no
 * consumer yet and a pre-existing mismatch against the actual BrandSettings
 * table (defaultTaxRateBp vs. the DB's defaultTaxRateId) — not this change's
 * concern to resolve. */
export const paymentMethodSettingsSchema = z.object({
  cardEnabled: z.boolean(),
  applePayEnabled: z.boolean(),
  googlePayEnabled: z.boolean(),
  achEnabled: z.boolean(),
  checkEnabled: z.boolean(),
});
export type PaymentMethodSettingsInput = z.infer<typeof paymentMethodSettingsSchema>;

/**
 * The two colours every Branding editor shows in its "Brand Elements" panel.
 * They live on different tables — themeColor on Brand, accentColor on
 * BrandSettings — but a merchant edits them as one thing, so every branding
 * write schema below carries both. That is what lets a single Save land as a
 * single transaction instead of the brand write, the accent write and the
 * section write racing each other as three separate requests.
 */
export const brandElementsSchema = z.object({
  themeColor: hexColourSchema,
  accentColor: hexColourSchema,
});
export type BrandElementsInput = z.infer<typeof brandElementsSchema>;

/** Brand Settings > Branding > Payment Page: how the hosted payment page
 * displays for this brand's customers. Separate from
 * paymentMethodSettingsSchema above (that's which methods are offered; this
 * is how the page around them looks). */
export const paymentPageDisplaySchema = brandElementsSchema.extend({
  paymentPageLayout: z.enum(['BANNER', 'CENTERED', 'SPLIT']),
});
export type PaymentPageDisplayInput = z.infer<typeof paymentPageDisplaySchema>;

/** Brand Settings > Branding > Email Templates: the subject/body template and
 * (shared) layout for the three automated emails a customer gets — the
 * invoice receipt, the payment confirmation, and the payment-failed notice.
 * One layout and one set of Brand Elements covers all three (the editor's
 * "Email Layout"/"Brand Elements" panels are not per-template), so only the
 * subject/body pairs are tripled here. Variables (`{{brand_name}}` etc.) are
 * free text here — substituted at send/preview time, not validated against a
 * fixed list, so a merchant can't be blocked from saving over a typo'd
 * placeholder. */
export const emailReceiptSettingsSchema = brandElementsSchema.extend({
  emailReceiptLayout: z.enum(EMAIL_RECEIPT_LAYOUTS),
  emailReceiptSubject: z.string().trim().min(1, 'subject is required').max(200),
  emailReceiptBody: z.string().trim().min(1, 'body is required').max(5000),
  paymentConfirmationSubject: z.string().trim().min(1, 'subject is required').max(200),
  paymentConfirmationBody: z.string().trim().min(1, 'body is required').max(5000),
  paymentFailedSubject: z.string().trim().min(1, 'subject is required').max(200),
  paymentFailedBody: z.string().trim().min(1, 'body is required').max(5000),
});
export type EmailReceiptSettingsInput = z.infer<typeof emailReceiptSettingsSchema>;

/** Brand Settings > Branding > Email Receipt's "Send a test email". Carries
 * the whole draft — layout and colours as well as subject/body — straight
 * from the editor rather than reading the brand's saved settings, so testing
 * a draft never requires saving it first, and the test email looks like what
 * the preview is showing rather than like the last saved version. */
export const emailReceiptTestSendSchema = brandElementsSchema.extend({
  to: emailSchema,
  emailReceiptLayout: z.enum(EMAIL_RECEIPT_LAYOUTS),
  emailReceiptSubject: z.string().trim().min(1, 'subject is required').max(200),
  emailReceiptBody: z.string().trim().min(1, 'body is required').max(5000),
});
export type EmailReceiptTestSendInput = z.infer<typeof emailReceiptTestSendSchema>;

/** The Invoice Details drawer's Send/Resend compose modal — the caller
 * supplies the exact, already-substituted subject/body/recipient it showed
 * on screen (pre-filled from Email Receipt settings, editable from there),
 * the same way emailReceiptTestSendSchema's caller does. `to` is not
 * required to match the customer's own email on file — a customer with none
 * on file starts this field blank and types one in, which this schema
 * accepts the same as any other address. */
export const sendInvoiceEmailSchema = z.object({
  to: emailSchema,
  /** '' (not omitted) means no CC — the compose modal always sends this
   * field, blank by default, same as `to` is never optional either. */
  cc: z.union([emailSchema, z.literal('')]).optional(),
  subject: z.string().trim().min(1, 'subject is required').max(200),
  body: z.string().trim().min(1, 'body is required').max(5000),
  /** The compose modal's "Attach Invoice PDF" checkbox — renders the same
   * PDF the Invoices detail drawer's own Download PDF button produces and
   * attaches it. Optional/omittable rather than defaulted false in the
   * schema so older clients that don't send it at all keep working. */
  attachPdf: z.boolean().optional(),
  /** The compose modal's optional "Preferred payment method" — carried as
   * ?method= on the emailed link so the payment page opens with that tile
   * already selected. MANUAL is deliberately excluded: it is the internal
   * recording of an offline payment, never a customer-facing choice. Purely
   * a UI convenience — PaymentsService.createIntent enforces the brand's
   * actual enabled methods regardless of what a link happens to preselect. */
  preferredMethod: z.enum(['CARD', 'WALLET', 'ACH', 'CHECK']).optional(),
});
export type SendInvoiceEmailInput = z.infer<typeof sendInvoiceEmailSchema>;

/** The Invoices list's "Bulk Send Invoices" — a batch of ids selected on
 * screen, each sent (or resent) with that invoice's own default Email
 * Receipt content; unlike sendInvoiceEmailSchema there is no per-invoice
 * compose step, so no to/subject/body travels here. Capped at 100 to keep
 * one request from running an unbounded number of real sends. */
export const bulkSendInvoicesSchema = z.object({
  ids: z
    .array(idSchema)
    .min(1, 'select at least one invoice')
    .max(100, 'select at most 100 invoices at a time'),
});
export type BulkSendInvoicesInput = z.infer<typeof bulkSendInvoicesSchema>;

/** Brand Settings > Branding > Invoice PDF: layout and which optional
 * sections appear on the invoice PDF a customer receives/downloads.
 * companyName/companyAddress are nullable — null means "use the brand's own
 * displayName/mailingAddress", not "blank"; the editor always submits the
 * value currently on screen, whether that's the fallback or an override. */
export const invoicePdfSettingsSchema = brandElementsSchema.extend({
  invoicePdfLayout: z.enum(['CLASSIC', 'MODERN', 'MINIMAL']),
  showCompanyAddress: z.boolean(),
  showPaymentTerms: z.boolean(),
  showTaxBreakdown: z.boolean(),
  showNotes: z.boolean(),
  companyName: z.string().trim().max(200).nullable(),
  companyAddress: z.string().trim().max(500).nullable(),
  paymentTerms: z.enum(['DUE_ON_RECEIPT', 'NET_15', 'NET_30', 'NET_60']),
  notes: z.string().trim().max(2000),
});
export type InvoicePdfSettingsInput = z.infer<typeof invoicePdfSettingsSchema>;

// Stripe has no schema here: under Connect a brand authorises the platform on
// Stripe's own consent screen rather than submitting credentials, so there is
// no request body to validate. The resulting account id is read from Stripe's
// OAuth response, never from a client.

/** FR-ZHO-030: a brand's Sync Frequency, in minutes between timed pulls
 * from Zoho (the 'scheduled-sync' cron's due-check is `now - lastPulledAt >=
 * frequency * 60_000`). 0 is Real-time: no timed pull at all, changes arrive
 * through Zoho's webhooks within seconds. Monthly is 30 days. */
export const ZOHO_SYNC_FREQUENCIES = [0, 15, 30, 60, 1440, 43200] as const;
export const zohoSyncFrequencySchema = z
  .number()
  .int()
  .refine(
    (v): v is (typeof ZOHO_SYNC_FREQUENCIES)[number] =>
      (ZOHO_SYNC_FREQUENCIES as readonly number[]).includes(v),
    {
      message:
        'choose Real-time (0), or every 15, 30 or 60 minutes, daily (1440) or monthly (43200)',
    },
  ) as unknown as z.ZodType<(typeof ZOHO_SYNC_FREQUENCIES)[number]>;
export type ZohoSyncFrequency = z.infer<typeof zohoSyncFrequencySchema>;

/** Every field optional and a live PATCH, not a form submit — the settings
 * panel saves each control the moment it changes, matching FR-ZHO-030's
 * "no separate Save button" requirement. At least one field is still
 * required so a client cannot send a body that changes nothing. */
export const zohoSyncSettingsSchema = z
  .object({
    pullFrequencyMinutes: zohoSyncFrequencySchema.optional(),
    customerSyncEnabled: z.boolean().optional(),
    invoiceSyncEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type ZohoSyncSettingsInput = z.infer<typeof zohoSyncSettingsSchema>;

// --- Zoho Books Sandbox (settings/config testing, not a separate test org) --
//
// Confirmed against https://www.zoho.com/books/api/v3/sandbox/: this manages
// a sandbox copy of the brand's *already-connected* production org (custom
// functions/workflows/fields), gated by ZohoBooks.settings.* scopes — not a
// parallel environment with its own credentials. See ZohoSandboxService.

/** Optional label only — Zoho itself names/numbers the sandbox. */
export const zohoSandboxCreateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});
export type ZohoSandboxCreateInput = z.infer<typeof zohoSandboxCreateSchema>;

export const zohoSandboxUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type ZohoSandboxUpdateInput = z.infer<typeof zohoSandboxUpdateSchema>;

export const zohoSandboxActivationSchema = z.object({
  active: z.boolean(),
});
export type ZohoSandboxActivationInput = z.infer<typeof zohoSandboxActivationSchema>;

export const zohoSandboxChangeReviewSchema = z.object({
  reviewed: z.boolean(),
});
export type ZohoSandboxChangeReviewInput = z.infer<typeof zohoSandboxChangeReviewSchema>;

export const zohoSandboxChangesScopeSchema = z.object({
  target: z.enum(['sandbox', 'production']).default('sandbox'),
});
export type ZohoSandboxChangesScopeInput = z.infer<typeof zohoSandboxChangesScopeSchema>;

/**
 * The one schema standing between an admin click and a real production
 * deployment. `confirm` must be the literal `true` — there is no default and
 * no way to satisfy this by accident, matching the requirement that pushing
 * sandbox changes to production is always an explicit administrative action.
 */
export const zohoSandboxPushConfirmSchema = z.object({
  confirm: z.literal(true),
});
export type ZohoSandboxPushConfirmInput = z.infer<typeof zohoSandboxPushConfirmSchema>;

// --- Customer --------------------------------------------------------------

export const customerTypeSchema = z.enum(['BUSINESS', 'INDIVIDUAL']);

export const customerSchema = z
  .object({
    type: customerTypeSchema,
    salutation: z.string().trim().max(32).nullable(),
    firstName: z.string().trim().max(120).nullable(),
    lastName: z.string().trim().max(120).nullable(),
    companyName: z.string().trim().max(200).nullable(),
    displayName: z.string().trim().min(1).max(200),
    email: emailSchema.nullable(),
    phone: phoneSchema.nullable(),
    billingAddress: addressSchema.nullable(),
    shippingAddress: addressSchema.nullable(),
  })
  .refine((v) => v.type !== 'BUSINESS' || Boolean(v.companyName), {
    message: 'a business customer needs a company name',
    path: ['companyName'],
  })
  .refine((v) => v.type !== 'INDIVIDUAL' || Boolean(v.firstName || v.lastName), {
    message: 'an individual customer needs a first or last name',
    path: ['firstName'],
  });
export type CustomerInput = z.infer<typeof customerSchema>;

// --- Invoice ---------------------------------------------------------------

export const lineItemSchema = z.object({
  itemName: z.string().trim().min(1, 'every line needs an item name').max(200),
  description: z.string().trim().max(2000).nullable(),
  quantity: quantityStringSchema,
  unitPrice: decimalAmountStringSchema,
  taxExempt: z.boolean().default(false),
});
export type LineItemInput = z.infer<typeof lineItemSchema>;

export const invoiceDraftSchema = z
  .object({
    brandId: idSchema,
    customerId: idSchema,
    invoiceDate: z.coerce.date(),
    dueDate: z.coerce.date(),
    currency: currencySchema,
    lines: z
      .array(lineItemSchema)
      .min(1, 'an invoice needs at least one line item')
      .max(500, 'an invoice may have at most 500 line items'),
    taxRateBp: basisPointsSchema,
    cardFeeRateBp: basisPointsSchema,
    notes: z.string().trim().max(4000).nullable(),
    internalNotes: z.string().trim().max(4000).nullable(),
  })
  .refine((v) => v.dueDate >= v.invoiceDate, {
    message: 'the due date cannot precede the invoice date',
    path: ['dueDate'],
  });
export type InvoiceDraftInput = z.infer<typeof invoiceDraftSchema>;

/** Methods staff can record by hand from the Invoice Details drawer — money
 * that arrived outside the platform. CARD and WALLET are excluded: those
 * only ever arrive through a gateway settlement, never typed in. */
export const MANUAL_PAYMENT_METHODS = ['MANUAL', 'CHECK', 'ACH'] as const;

/** The Invoice Details drawer's "Record Payment". The amount is a decimal
 * string, same as a line item's unitPrice, and is converted to minor units
 * against the invoice's own currency server-side. */
export const recordManualPaymentSchema = z.object({
  amount: decimalAmountStringSchema,
  method: z.enum(MANUAL_PAYMENT_METHODS),
  paidAt: z.coerce.date(),
  reference: z.string().trim().max(200).optional(),
});
export type RecordManualPaymentInput = z.infer<typeof recordManualPaymentSchema>;

export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

/** Invoice list filters — FR-INV list view: date, brand, and status tabs.
 * `search` matches the invoice number OR the customer's display name (the
 * list shows both), and `excludeOverdue` is what the Unpaid/Partial tabs use
 * to keep an overdue invoice in the Overdue tab only, never double-counted —
 * `overdueOnly` (true) and `excludeOverdue` (true) are never sent together. */
export const invoiceListQuerySchema = paginationSchema.extend({
  brandId: idSchema.optional(),
  customerId: idSchema.optional(),
  status: arrayQueryParam(invoiceStatusSchema).optional(),
  overdueOnly: z.coerce.boolean().optional(),
  excludeOverdue: z.coerce.boolean().optional(),
  search: z.string().trim().max(200).optional(),
  dateRange: dateRangeSchema.optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

/** The Invoices list's tab badge counts (All/Draft/Unpaid/Partial/Paid/Overdue)
 * — same search/date filters as the list itself, no status/pagination: every
 * bucket's count has to reflect the filters currently applied to the list,
 * just not the tab selection the counts are themselves choosing between. */
export const invoiceTabCountsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  dateRange: dateRangeSchema.optional(),
});
export type InvoiceTabCountsQuery = z.infer<typeof invoiceTabCountsQuerySchema>;

export const customerListQuerySchema = paginationSchema.extend({
  brandId: idSchema.optional(),
  hasOutstanding: z.coerce.boolean().optional(),
  search: z.string().trim().max(200).optional(),
  dateRange: dateRangeSchema.optional(),
  // Customers pulled from Zoho are archived, not deleted, when Zoho no
  // longer reports them (ZohoPullService.archiveMissingCustomers) — this
  // keeps the default list view free of them without losing the record.
  includeArchived: z.coerce.boolean().optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

// --- Payment ---------------------------------------------------------------

export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

/** Brand Settings > Payment Gateways' Transaction Log — date range, status
 * and method are all filtered here now rather than against whichever page
 * happens to already be in the browser, so a filter stays accurate no
 * matter how many pages of history a brand has. */
export const paymentListQuerySchema = paginationSchema.extend({
  status: arrayQueryParam(paymentStatusSchema).optional(),
  method: arrayQueryParam(paymentMethodSchema).optional(),
  dateRange: dateRangeSchema.optional(),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

export const paymentIntentRequestSchema = z.object({
  publicToken: z.string().regex(/^[0-9a-f]{32}$/),
  method: paymentMethodSchema,
  /** Present only when the brand allows partial payment. */
  amount: decimalAmountStringSchema.optional(),
  /** Client-generated, so a double submit collapses to one charge. */
  attemptNonce: z.string().min(8).max(64),
});
export type PaymentIntentRequest = z.infer<typeof paymentIntentRequestSchema>;

/**
 * Fallback for when the gateway's webhook cannot reach this platform (no
 * public HTTPS endpoint registered yet) but the customer's own browser
 * already holds the gateway's confirmation that the charge succeeded or
 * failed. `gatewayReference` is the same id the client already has from the
 * intent it created (Stripe's client_secret is `{id}_secret_{...}`) — the
 * server re-fetches this id's real status from the gateway itself before
 * acting on it, never trusting the client's own claim.
 */
export const paymentIntentReconcileSchema = z.object({
  gatewayReference: z.string().min(1).max(200),
});
export type PaymentIntentReconcileRequest = z.infer<typeof paymentIntentReconcileSchema>;

// --- Check submission (Payments > Check Verifications) ---------------------

/** UI-facing bucket, not the raw `CheckStatus` enum — `PENDING` covers both
 * `SUBMITTED` and `UNDER_REVIEW` so the tab filter doesn't need to know about
 * a review-in-progress state nothing surfaces separately yet. */
export const CHECK_REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const checkReviewStatusSchema = z.enum(CHECK_REVIEW_STATUSES);
export type CheckReviewStatus = z.infer<typeof checkReviewStatusSchema>;

export const checkSubmissionListQuerySchema = paginationSchema.extend({
  status: checkReviewStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
});
export type CheckSubmissionListQuery = z.infer<typeof checkSubmissionListQuerySchema>;

/** Approve takes an optional note; reject requires one (the service enforces
 * the "required for reject" half — one shared shape is simpler than two
 * near-identical schemas). */
export const reviewCheckSubmissionSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  /** Approve only: the amount written on the check, as the reviewer read it.
   * Defaults to what the customer claimed (the balance when they uploaded). */
  amount: decimalAmountStringSchema.optional(),
});
export type ReviewCheckSubmissionInput = z.infer<typeof reviewCheckSubmissionSchema>;

/** The customer-facing half of Upload Check (public payment page) — paired
 * with the front/back images, sent as multipart fields alongside this JSON-
 * shaped pair rather than as a JSON body (checkNumber/customerNote still
 * validate the same way: multer hands multipart text fields through as
 * plain strings, exactly like a JSON body would). */
export const createCheckSubmissionSchema = z.object({
  checkNumber: z.string().trim().min(1, 'check number is required').max(100),
  customerNote: z.string().trim().max(1000).optional(),
});
export type CreateCheckSubmissionInput = z.infer<typeof createCheckSubmissionSchema>;

// --- Dashboard -------------------------------------------------------------

export const dashboardQuerySchema = z.object({
  brandId: idSchema.optional(),
  dateRange: dateRangeSchema.optional(),
  /** Flat range bounds for the KPI cards / By Brand rollup — a preset
   * (This Month, Last Quarter, ...) resolved to concrete dates client-side,
   * simpler to send as query params than the nested `dateRange` above. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
