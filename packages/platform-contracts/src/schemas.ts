import { z } from 'zod';
import {
  addressSchema,
  currencySchema,
  emailSchema,
  hexColourSchema,
  idSchema,
  paginationSchema,
  phoneSchema,
  SUPPORTED_CURRENCIES,
  timezoneSchema,
  usPhoneSchema,
} from '@platform/kernel';
import { ROLES } from './roles.js';
import { BUSINESS_TYPES } from './business-type.js';
import { checkBusinessEmail, normalizeWebsiteDomain } from './company-domain.js';

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

/** FR-AUTH-005: "I forgot my password." Only an address — proving control of
 * it is what the emailed link is for. */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

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
  /** Required for a voluntary change; the forced first-login reset has none. */
  currentPassword: z.string().max(200).optional(),
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

/** A company email: a valid address that is not from a free email provider
 * (gmail.com, outlook.com, ...). */
export const companyEmailSchema = z
  .string({ required_error: 'email is required' })
  .trim()
  .min(1, 'email is required')
  .pipe(emailSchema)
  .refine((email) => checkBusinessEmail(email, null).reason !== 'FREE_PROVIDER', {
    message: 'use your company email address, not a personal email provider',
  });

/**
 * Sign Up: a company email and a password. The person becomes the Company
 * Admin of a new company and is signed in; the company is registered next.
 */
export const registerSchema = z.object({
  email: companyEmailSchema,
  password: z
    .string({ required_error: 'password is required' })
    .min(1, 'password is required')
    .pipe(passwordSchema),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// --- Company onboarding ------------------------------------------------------

/** Where a company's onboarding stands, worked out from its data on every
 * request (MerchantService.nextStep). */
export const ONBOARDING_STEPS = ['REGISTER_COMPANY', 'ADD_BRAND', 'SELECT_PRODUCTS'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Letters, digits, spaces and - . / only: an EIN (12-3456789), a VAT or NTN
 * number, with or without separators. */
const TAX_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/;

/** Register Your Company. Every field is required. */
export const registerCompanySchema = z.object({
  companyName: z
    .string({ required_error: 'company name is required' })
    .trim()
    .min(1, 'company name is required')
    .max(120)
    // One space between words: "Acme  Ltd" and "Acme Ltd" are one name.
    .transform((v) => v.replace(/\s+/g, ' ')),
  legalName: z
    .string({ required_error: 'legal name is required' })
    .trim()
    .min(1, 'legal name is required')
    .max(200),
  taxId: z
    .string({ required_error: 'tax ID is required' })
    .trim()
    .min(1, 'tax ID is required')
    .max(64)
    .regex(TAX_ID_PATTERN, 'a tax ID may contain only letters, digits, spaces and - . /'),
  brandStructure: z.enum(['SINGLE', 'MULTI'], {
    errorMap: () => ({ message: 'choose single brand or multiple brands' }),
  }),
});
export type RegisterCompanyInput = z.infer<typeof registerCompanySchema>;

/** Add Your Brand: the company's first brand. Theme colour is optional. */
export const firstBrandSchema = z.object({
  legalName: z
    .string({ required_error: 'legal name is required' })
    .trim()
    .min(1, 'legal name is required')
    .max(200),
  displayName: z
    .string({ required_error: 'display name is required' })
    .trim()
    .min(1, 'display name is required')
    .max(120),
  currency: z
    .string({ required_error: 'currency is required' })
    .trim()
    .min(1, 'currency is required')
    .toUpperCase()
    .pipe(
      z.enum(SUPPORTED_CURRENCIES, {
        errorMap: () => ({
          message: `choose one of the supported currencies: ${SUPPORTED_CURRENCIES.join(', ')}`,
        }),
      }),
    ),
  timezone: z.string({ required_error: 'time zone is required' }).pipe(timezoneSchema),
  themeColor: hexColourSchema.nullish(),
});
export type FirstBrandInput = z.infer<typeof firstBrandSchema>;

// --- Brand -----------------------------------------------------------------

export const businessTypeSchema = z.enum(BUSINESS_TYPES);

/** US EIN: two digits, a hyphen, seven digits — e.g. 12-3456789. */
const EIN_PATTERN = /^\d{2}-\d{7}$/;
export const TAX_ID_FORMAT_MESSAGE = 'a US Tax ID must be an EIN in the form 12-3456789';

/** Exported so client-side forms can check EIN shape as the user types,
 * without pulling in the full brand/company-details object shape that
 * taxIdMatchesCountry below needs. */
export function isValidEin(taxId: string): boolean {
  return EIN_PATTERN.test(taxId);
}

/** Exported so createBrandSchema (API controller, adds invoicePrefix) can
 * apply the identical check after extending the object — a schema produced
 * by `.refine()` has no `.extend()` of its own to build on. */
export function taxIdMatchesCountry(v: {
  readonly mailingAddress: { readonly country: string | null } | null;
  readonly taxId: string | null;
}): boolean {
  return v.mailingAddress?.country !== 'US' || !v.taxId || isValidEin(v.taxId);
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

/** Company website — normalized to a bare domain (`acme.com`) regardless of
 * scheme, `www.`, casing or a trailing slash, so it compares cleanly against
 * the business email's domain. */
export const websiteSchema = z
  .string()
  .trim()
  .max(253)
  .nullable()
  .refine((v) => v === null || normalizeWebsiteDomain(v) !== null, {
    message: 'enter a valid company website, e.g. acme.com',
  })
  .transform((v) => (v === null ? null : normalizeWebsiteDomain(v)));

/** Exported so callers building on companyDetailsObjectSchema can apply the
 * identical check after extending it — see taxIdMatchesCountry above for why
 * a `.refine()`'d schema needs this rather than an inherited `.extend()`. */
export function businessEmailMatchesWebsite(v: {
  readonly email: string | null;
  readonly website: string | null;
}): boolean {
  if (!v.email) return true;
  return checkBusinessEmail(v.email, v.website).ok;
}

const BUSINESS_EMAIL_MESSAGES: Record<string, string> = {
  FREE_PROVIDER: 'use your company email address rather than a personal email provider',
  DOMAIN_MISMATCH: "this email doesn't match your company website's domain",
};

/** Staged on Merchant before any Brand exists — same fields as brandObjectSchema
 * minus the settings a Brand needs but a company doesn't have yet (currency,
 * timezone, invoice prefix, theme colour, display name). */
export const companyDetailsObjectSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  /** Trading name, where it differs from the legal one. */
  dba: z.string().trim().max(200).nullable(),
  businessType: businessTypeSchema,
  /** US-only — see usPhoneSchema. */
  phone: usPhoneSchema.nullable(),
  email: emailSchema.nullable(),
  website: websiteSchema,
  mailingAddress: addressSchema.nullable(),
  billingAddress: addressSchema.nullable(),
  taxId: z.string().trim().max(64).nullable(),
});
export const companyDetailsSchema = companyDetailsObjectSchema
  .refine(taxIdMatchesCountry, {
    message: TAX_ID_FORMAT_MESSAGE,
    path: ['taxId'],
  })
  .refine(businessEmailMatchesWebsite, (v) => ({
    message: v.email
      ? (BUSINESS_EMAIL_MESSAGES[checkBusinessEmail(v.email, v.website).reason ?? ''] ??
        'enter a valid business email address')
      : 'enter a valid business email address',
    path: ['email'],
  }));
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

// --- Payment gateways (Brand Settings → Payment Gateways) -------------------

/** The four gateways the Payment Gateways tab can connect. STRIPE alone
 * completes real OAuth (StripeAccountService); the other three have no
 * credential handshake behind them yet, so connecting one just records the
 * brand's choice (PaymentGatewaysService). */
export const PAYMENT_GATEWAY_PROVIDERS = ['STRIPE', 'PAYPAL', 'SQUARE', 'AUTHORIZE_NET'] as const;
export type PaymentGatewayProvider = (typeof PAYMENT_GATEWAY_PROVIDERS)[number];
export const paymentGatewayProviderSchema = z.enum(PAYMENT_GATEWAY_PROVIDERS);

/** Authorize.net has no OAuth consent screen for third parties — a brand
 * connects by pasting its own API Login ID and Transaction Key rather than
 * authorising through a redirect, the same shape Stripe's pre-Connect flow
 * used before it moved to OAuth. See AuthorizeNetAccountService. */
export const authorizeNetConnectSchema = z.object({
  apiLoginId: z.string().trim().min(1, 'API Login ID is required').max(100),
  transactionKey: z.string().trim().min(1, 'Transaction Key is required').max(100),
  environment: z.enum(['sandbox', 'production']),
});
export type AuthorizeNetConnectInput = z.infer<typeof authorizeNetConnectSchema>;

export const roleSchema = z.enum(ROLES);

// --- Users / Roles (FR-USR) -------------------------------------------------
//
// Roles and permissions are computed from the fixed matrix in domain/roles.ts
// (never stored per user); what's dynamic here is which role and which brands
// a user holds. INVITED is set by the server on invite and is never a caller
// choice, so it is deliberately excluded from userStatusSchema.

export const userStatusSchema = z.enum(['ACTIVE', 'SUSPENDED']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const inviteUserSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  email: emailSchema,
  role: roleSchema,
  /** Ignored for an all-brand role (Owner/Admin); required for any other
   * role — enforced in UsersService, where coversAllBrands() already lives. */
  brandIds: z.array(idSchema).max(200).default([]),
  /** Roles in other products (e.g. `{ HQ: 'MANAGER' }`). The invoicing role
   * defaults to `role`. Each value is checked against PRODUCT_ROLES. */
  productRoles: z
    .object({
      INVOICING: z.string().trim().min(1).max(60).optional(),
      HQ: z.string().trim().min(1).max(60).optional(),
    })
    .strict()
    .optional(),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserRoleSchema = z.object({
  role: roleSchema,
  /** Required when moving a user from an all-brand role (Owner/Admin) to a
   * brand-scoped one — they hold no assignments, and a brand-scoped role
   * with none is an account that can see nothing. Applied in the same
   * transaction as the role change; enforced in UsersService. */
  brandIds: z.array(idSchema).max(200).optional(),
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

export const assignUserBrandsSchema = z.object({
  brandIds: z.array(idSchema).max(200),
});
export type AssignUserBrandsInput = z.infer<typeof assignUserBrandsSchema>;

export const updateUserStatusSchema = z.object({
  status: userStatusSchema,
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const userListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;
