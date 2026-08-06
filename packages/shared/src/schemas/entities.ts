import { z } from 'zod';
import { ROLES } from '../domain/roles.js';
import { BUSINESS_TYPES } from '../domain/business-type.js';
import { INVOICE_STATUSES } from '../domain/invoice-status.js';
import { PAYMENT_METHODS } from '../money/calculation.js';
import {
  addressSchema,
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
  timezoneSchema,
} from './common.js';

// --- Authentication --------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'password is required').max(200),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Self-serve signup. Deliberately only a name and an email — no password.
 *
 * The account is created in the INVITED state with an unusable password hash,
 * and registration issues a session directly, so the very next thing the new
 * owner does is choose their own password through the existing forced-reset
 * step (FR-AUTH-007/021). That means no temporary password is ever minted,
 * transmitted, or left sitting in an inbox.
 */
export const registerSchema = z.object({
  fullName: z.string().trim().min(1, 'your name is required').max(120),
  email: emailSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** NFR-SEC: length over composition rules. */
export const passwordSchema = z
  .string()
  .min(12, 'use at least 12 characters')
  .max(200, 'passwords are capped at 200 characters');

/** FR-AUTH-007/FR-AUTH-021: setting a password, whether a first-login forced
 * reset off a temporary one or a voluntary change later — same rule either
 * way, since a password set under duress is not allowed to be weaker than one
 * set by choice. */
export const setPasswordSchema = z.object({
  newPassword: passwordSchema,
});
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

/** Setting a password from an emailed link, with no session yet. The token is
 * the credential, so it is validated for shape here and verified for real
 * against its stored digest in PasswordResetService. */
export const setPasswordWithTokenSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, 'malformed token'),
  newPassword: passwordSchema,
});
export type SetPasswordWithTokenInput = z.infer<typeof setPasswordWithTokenSchema>;

// --- Brand -----------------------------------------------------------------

export const businessTypeSchema = z.enum(BUSINESS_TYPES);

/** US EIN: two digits, a hyphen, seven digits — e.g. 12-3456789. */
const EIN_PATTERN = /^\d{2}-\d{7}$/;
export const TAX_ID_FORMAT_MESSAGE = 'a US Tax ID must be an EIN in the form 12-3456789';

/** Exported so createBrandSchema (API controller, adds invoicePrefix) can
 * apply the identical check after extending the object — a schema produced
 * by `.refine()` has no `.extend()` of its own to build on. */
export function taxIdMatchesCountry(v: {
  readonly mailingAddress: { readonly country: string | null } | null;
  readonly taxId: string | null;
}): boolean {
  return v.mailingAddress?.country !== 'US' || !v.taxId || EIN_PATTERN.test(v.taxId);
}

export const brandObjectSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(120),
  businessType: businessTypeSchema,
  salesPersonName: z.string().trim().max(160).nullable(),
  phone: phoneSchema.nullable(),
  email: emailSchema.nullable(),
  mailingAddress: addressSchema.nullable(),
  billingAddress: addressSchema.nullable(),
  taxId: z.string().trim().max(64).nullable(),
  currency: currencySchema,
  timezone: timezoneSchema,
  themeColor: hexColourSchema,
});

// --- Onboarding (FR-ONB) -----------------------------------------------------

/** Staged on Merchant before any Brand exists — same fields as brandObjectSchema
 * minus the settings a Brand needs but a company doesn't have yet (currency,
 * timezone, invoice prefix, theme colour, display name). */
export const companyDetailsObjectSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  businessType: businessTypeSchema,
  phone: phoneSchema.nullable(),
  email: emailSchema.nullable(),
  mailingAddress: addressSchema.nullable(),
  billingAddress: addressSchema.nullable(),
  taxId: z.string().trim().max(64).nullable(),
});
export const companyDetailsSchema = companyDetailsObjectSchema.refine(taxIdMatchesCountry, {
  message: TAX_ID_FORMAT_MESSAGE,
  path: ['taxId'],
});
export type CompanyDetailsInput = z.infer<typeof companyDetailsObjectSchema>;

export const BRAND_STRUCTURES = ['SINGLE', 'MULTI'] as const;
export type BrandStructure = (typeof BRAND_STRUCTURES)[number];

export const brandStructureChoiceSchema = z.object({
  structure: z.enum(BRAND_STRUCTURES),
});
export type BrandStructureChoiceInput = z.infer<typeof brandStructureChoiceSchema>;

export const brandSchema = brandObjectSchema.refine(taxIdMatchesCountry, {
  message: TAX_ID_FORMAT_MESSAGE,
  path: ['taxId'],
});
export type BrandInput = z.infer<typeof brandObjectSchema>;

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

// Stripe has no schema here: under Connect a brand authorises the platform on
// Stripe's own consent screen rather than submitting credentials, so there is
// no request body to validate. The resulting account id is read from Stripe's
// OAuth response, never from a client.

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
    lines: z.array(lineItemSchema).min(1, 'an invoice needs at least one line item'),
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

export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export const roleSchema = z.enum(ROLES);

/** Invoice list filters — FR-INV list view: date, brand, and status tabs. */
export const invoiceListQuerySchema = paginationSchema.extend({
  brandId: idSchema.optional(),
  customerId: idSchema.optional(),
  status: z.array(invoiceStatusSchema).optional(),
  overdueOnly: z.coerce.boolean().optional(),
  search: z.string().trim().max(200).optional(),
  dateRange: dateRangeSchema.optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const customerListQuerySchema = paginationSchema.extend({
  brandId: idSchema.optional(),
  hasOutstanding: z.coerce.boolean().optional(),
  search: z.string().trim().max(200).optional(),
  dateRange: dateRangeSchema.optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

// --- Payment ---------------------------------------------------------------

export const paymentIntentRequestSchema = z.object({
  publicToken: z.string().regex(/^[0-9a-f]{32}$/),
  method: paymentMethodSchema,
  /** Present only when the brand allows partial payment. */
  amount: decimalAmountStringSchema.optional(),
  /** Client-generated, so a double submit collapses to one charge. */
  attemptNonce: z.string().min(8).max(64),
});
export type PaymentIntentRequest = z.infer<typeof paymentIntentRequestSchema>;

// --- Dashboard -------------------------------------------------------------

export const dashboardQuerySchema = z.object({
  brandId: idSchema.optional(),
  dateRange: dateRangeSchema.optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
