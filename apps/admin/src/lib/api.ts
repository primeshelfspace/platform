/**
 * The admin app's connection to the API.
 *
 * This app is a back-end-for-front-end: every call below runs on the server, and
 * the session token is read from this origin's httpOnly cookie and replayed
 * upstream as a bearer token. The API is a separate deployment (TDD-001
 * ADR-002), which is why this is a fetch client rather than a direct database
 * call from a server component, and why a cookie set by the API cannot simply be
 * forwarded — see lib/session.ts.
 */

import type { BusinessType, InvoiceStatus } from '@fenwick/shared';
import { readSessionToken } from './session';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * A 401 from upstream means the session is gone — expired, revoked, or signed
 * out in another tab. It is raised as its own type so the authenticated layout
 * can send the user to /login instead of every page rendering "could not load".
 */
export class SessionExpiredError extends ApiError {
  constructor(message = 'session expired') {
    super(401, message);
    this.name = 'SessionExpiredError';
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { revalidate?: number; token?: string | null } = {},
): Promise<T> {
  const { revalidate, token, ...requestInit } = init;

  // An explicit token is passed by the sign-in action, which runs before the
  // cookie it is about to set exists.
  const sessionToken = token === undefined ? await readSessionToken() : token;

  const response = await fetch(`${API_URL}${path}`, {
    ...requestInit,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...requestInit.headers,
    },
    // Health and status must never be served from a cache; a stale "ok" is
    // worse than no answer.
    cache: revalidate === undefined ? 'no-store' : undefined,
    ...(revalidate === undefined ? {} : { next: { revalidate } }),
  });

  const text = await response.text();
  const body = text ? safeJson(text) : null;

  if (!response.ok) {
    const message =
      (body as { message?: string } | null)?.message ?? `${response.status} ${response.statusText}`;
    if (response.status === 401) throw new SessionExpiredError(message);
    throw new ApiError(response.status, message, body);
  }

  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Bypasses apiFetch's JSON body: multipart needs its own Content-Type
 * boundary, which fetch sets itself from a FormData body. */
async function apiUploadFetch<T>(path: string, file: File): Promise<T> {
  const token = await readSessionToken();
  const body = new FormData();
  body.append('file', file);

  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
    cache: 'no-store',
  });

  const text = await response.text();
  const parsed = text ? safeJson(text) : null;

  if (!response.ok) {
    const message =
      (parsed as { message?: string } | null)?.message ??
      `${response.status} ${response.statusText}`;
    if (response.status === 401) throw new SessionExpiredError(message);
    throw new ApiError(response.status, message, parsed);
  }

  return parsed as T;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  environment: string;
  adapters: Record<string, string>;
  checks: Array<{
    name: string;
    state: 'up' | 'down' | 'skipped';
    durationMs: number;
    detail?: string;
  }>;
  checkedAt: string;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health');
}

// --- Authentication (FR-AUTH) -------------------------------------------------

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: CurrentUser;
}

export interface CurrentUser {
  id: string;
  merchantId: string;
  email: string;
  name: string;
  role: string;
  assignedBrandIds: string[];
  /** True for an INVITED user still signed in on the temporary password set
   * for them — the layout sends these straight to /set-password. */
  mustResetPassword: boolean;
}

/** `token: null` because there is no session yet — this is the call that mints one. */
export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    token: null,
  });
}

/**
 * Self-serve signup. Returns only an acknowledgement — the account is not
 * usable until the emailed set-password link is followed, so there is no
 * session to hand back. `token: null` because none exists yet.
 */
export function register(fullName: string, email: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ fullName, email }),
    token: null,
  });
}

/**
 * Sets the password from an emailed link. Returns a session, so the new owner
 * continues straight into onboarding rather than being sent back to /login to
 * type the password they just chose.
 */
export function setPasswordWithToken(token: string, newPassword: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/set-password/token', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
    token: null,
  });
}

/**
 * FR-AUTH-005: "I forgot my password." Always resolves — the API acknowledges
 * identically whether or not the address matches an account, so there is
 * nothing here for the caller to branch on. `token: null` because there is no
 * session yet.
 */
export function requestPasswordReset(email: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
    token: null,
  });
}

export function logout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST' });
}

export function getCurrentUser(): Promise<CurrentUser> {
  return apiFetch<CurrentUser>('/auth/me');
}

/** FR-AUTH-007/021: forced first-login reset off a temporary password, or a
 * later voluntary change — same endpoint either way. Requires only the live
 * session already on this request, not the current password. */
export function setPassword(newPassword: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/auth/set-password', {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
}

// --- Brands ------------------------------------------------------------------

export interface Brand {
  id: string;
  displayName: string;
  legalName: string;
  businessType: BusinessType | null;
  salesPerson: string | null;
  phone: string | null;
  email: string | null;
  mailingAddress: CustomerAddress | null;
  billingAddress: CustomerAddress | null;
  taxId: string | null;
  themeColor: string;
  currency: string;
  timezone: string;
  status: 'ACTIVE' | 'ARCHIVED';
  /** Signed, time-limited URL; null if this brand has no logo uploaded. */
  logoUrl: string | null;
}

export function listBrands(): Promise<Brand[]> {
  return apiFetch<Brand[]>('/brands');
}

/** Mirrors brandSchema in the API exactly — nullable fields must be sent as
 * `null`, not omitted. Shared by create (which adds invoicePrefix, a
 * BrandSettings field with no meaning outside creation) and update. */
export interface BrandFormInput {
  legalName: string;
  displayName: string;
  businessType: BusinessType;
  salesPersonName: string | null;
  phone: string | null;
  email: string | null;
  mailingAddress: CustomerAddress | null;
  billingAddress: CustomerAddress | null;
  taxId: string | null;
  currency: string;
  timezone: string;
  themeColor: string;
}

export function createBrand(input: BrandFormInput & { invoicePrefix: string }): Promise<Brand> {
  return apiFetch<Brand>('/brands', { method: 'POST', body: JSON.stringify(input) });
}

/** Brand Settings' "Brand Details" tab. Full replace, same shape as
 * createBrand minus invoicePrefix — see BrandsService.update for why there
 * is no partial form. */
export function updateBrand(brandId: string, input: BrandFormInput): Promise<Brand> {
  return apiFetch<Brand>(`/brands/${brandId}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** Separate from createBrand because the logo's storage key is namespaced by
 * brand id (brands/{id}/logo/...) — there is nothing to upload to until the
 * brand exists. */
export function uploadBrandLogo(brandId: string, file: File): Promise<{ logoUrl: string }> {
  return apiUploadFetch(`/brands/${brandId}/logo`, file);
}

// --- Merchant onboarding (FR-ONB) ---------------------------------------------

/** A brand has no meaning until a merchant decides whether it operates one
 * or several — these are staged directly on the merchant, not a Brand,
 * because no Brand may exist yet when this is collected. */
export interface CompanyDetails {
  legalName: string;
  dba: string | null;
  businessType: BusinessType | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  mailingAddress: CustomerAddress | null;
  billingAddress: CustomerAddress | null;
  taxId: string | null;
  hasLogo: boolean;
}

export interface MerchantOnboardingState {
  /** Null until setCompanyDetails has been called at least once. */
  companyDetails: CompanyDetails | null;
  /** Null until chooseBrandStructure has been called. */
  brandStructure: 'SINGLE' | 'MULTI' | null;
  hasBrands: boolean;
  /** SINGLE sets this the instant its one brand is created. MULTI leaves it
   * false until completeMultiBrandOnboarding is called — how many brands a
   * MULTI merchant intends to add isn't implied by any count of brands. */
  onboardingComplete: boolean;
}

export function getMerchantOnboarding(): Promise<MerchantOnboardingState> {
  return apiFetch<MerchantOnboardingState>('/merchant/onboarding');
}

export interface CompanyDetailsFormInput {
  legalName: string;
  dba: string | null;
  businessType: BusinessType;
  phone: string | null;
  email: string | null;
  website: string | null;
  mailingAddress: CustomerAddress | null;
  billingAddress: CustomerAddress | null;
  taxId: string | null;
}

export function saveCompanyDetails(input: CompanyDetailsFormInput): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/merchant/company-details', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function uploadCompanyLogo(file: File): Promise<{ logoUrl: string }> {
  return apiUploadFetch('/merchant/logo', file);
}

export interface ChooseBrandStructureResult {
  /** Populated only for SINGLE — the one brand just created from the staged
   * company details. Null for MULTI, which creates no brand by itself. */
  brand: { id: string; displayName: string } | null;
}

export function chooseBrandStructure(
  structure: 'SINGLE' | 'MULTI',
): Promise<ChooseBrandStructureResult> {
  return apiFetch<ChooseBrandStructureResult>('/merchant/brand-structure', {
    method: 'POST',
    body: JSON.stringify({ structure }),
  });
}

/** MULTI's own "I'm done adding brands" action — rejected by the API if no
 * brand has been created yet. */
export function completeMultiBrandOnboarding(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/merchant/complete-onboarding', { method: 'POST' });
}

// --- Customers (FR-CUS) ------------------------------------------------------

export interface CustomerAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface Customer {
  id: string;
  brandId: string;
  type: 'BUSINESS' | 'INDIVIDUAL';
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  billingAddress: CustomerAddress | null;
  shippingAddress: CustomerAddress | null;
  zohoContactId: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
}

/** A listing row — Customer plus the three figures the table shows that a
 * single customer fetch has no need for (FR-CUS list view). */
export interface CustomerListRow extends Customer {
  outstandingMinor: number;
  invoiceCount: number;
  paymentCount: number;
}

/** A named person at the customer — Zoho-sourced (FR-ZHO-030), read-only
 * from this app's side today. Mirrors LineItem's own role on Invoice below:
 * a small, bounded child collection returned only alongside a single-record
 * fetch, never on the list endpoint (see CustomerWithContacts). */
export interface CustomerContactPerson {
  id: string;
  salutation: string | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  skype: string | null;
  designation: string | null;
  department: string | null;
  isPrimaryContact: boolean;
}

/** What getCustomer actually returns — contactPersons rides along on the
 * single-record fetch only; CustomerListRow (the list endpoint) has no
 * equivalent field, so this is deliberately not folded into Customer itself. */
export interface CustomerWithContacts extends Customer {
  contactPersons: CustomerContactPerson[];
}

export interface CustomerListResponse {
  data: CustomerListRow[];
  page: number;
  pageSize: number;
  total: number;
}

export function listCustomers(
  brandId: string,
  params: {
    search?: string;
    hasOutstanding?: boolean;
    includeArchived?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<CustomerListResponse> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.hasOutstanding !== undefined) qs.set('hasOutstanding', String(params.hasOutstanding));
  if (params.includeArchived) qs.set('includeArchived', 'true');
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<CustomerListResponse>(`/brands/${brandId}/customers${suffix}`);
}

export function getCustomer(brandId: string, id: string): Promise<CustomerWithContacts> {
  return apiFetch<CustomerWithContacts>(`/brands/${brandId}/customers/${id}`);
}

/** Mirrors customerSchema in packages/shared exactly — nullable fields must be
 * sent as `null`, not omitted; Zod's .nullable() requires the key to be present. */
export interface CustomerFormInput {
  type: 'BUSINESS' | 'INDIVIDUAL';
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  billingAddress: CustomerAddress | null;
  shippingAddress: CustomerAddress | null;
}

export function createCustomer(brandId: string, input: CustomerFormInput): Promise<Customer> {
  return apiFetch<Customer>(`/brands/${brandId}/customers`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCustomer(
  brandId: string,
  id: string,
  input: CustomerFormInput,
): Promise<Customer> {
  return apiFetch<Customer>(`/brands/${brandId}/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// --- Invoices (FR-INV) --------------------------------------------------------

export interface LineItem {
  id: string;
  position: number;
  itemName: string;
  description: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  taxExempt: boolean;
}

export interface Invoice {
  id: string;
  brandId: string;
  customerId: string;
  number: string;
  status: InvoiceStatus;
  /** Overlay flag, not part of the status enum — set by a scheduled job once
   * the due date passes with a positive balance (see invoice-status.ts). */
  overdue: boolean;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  subtotalMinor: number;
  taxRateBpApplied: number;
  taxMinor: number;
  cardFeeRateBpApplied: number;
  totalMinor: number;
  balanceMinor: number;
  publicToken: string;
  /** Set once ZohoPullService/ZohoSyncService has actually pushed or pulled
   * this exact invoice — null means it has never touched Zoho, whether or
   * not the brand is connected. */
  zohoInvoiceId: string | null;
  lineItems: LineItem[];
  /** Only present on list rows — a single-invoice fetch has no need for it. */
  customer?: { displayName: string };
}

export interface InvoiceListResponse {
  data: Invoice[];
  page: number;
  pageSize: number;
  total: number;
}

export function listInvoices(
  brandId: string,
  params: { page?: number; pageSize?: number; customerId?: string } = {},
): Promise<InvoiceListResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.customerId) qs.set('customerId', params.customerId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<InvoiceListResponse>(`/brands/${brandId}/invoices${suffix}`);
}

export interface InvoiceSummary {
  /** Summed in the database across every open invoice, not just this page. */
  outstandingMinor: number;
  openCount: number;
}

export function getInvoiceSummary(brandId: string): Promise<InvoiceSummary> {
  return apiFetch<InvoiceSummary>(`/brands/${brandId}/invoices/summary`);
}

export interface LineItemFormInput {
  itemName: string;
  description: string | null;
  quantity: string;
  unitPrice: string;
  taxExempt: boolean;
}

/** Mirrors invoiceDraftSchema in packages/shared. brandId travels in the URL,
 * not this payload — the field the schema still requires there is ignored by
 * the service (see InvoicesController). */
export interface InvoiceFormInput {
  brandId: string;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  lines: LineItemFormInput[];
  taxRateBp: number;
  cardFeeRateBp: number;
  notes: string | null;
  internalNotes: string | null;
}

export function createInvoice(brandId: string, input: InvoiceFormInput): Promise<Invoice> {
  return apiFetch<Invoice>(`/brands/${brandId}/invoices`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function issueInvoice(brandId: string, id: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/brands/${brandId}/invoices/${id}/issue`, { method: 'POST' });
}

/** What the Invoice Details screen's single-invoice fetch returns —
 * Invoice's customer is fully resolved (email, formatted billing address),
 * where the list row above only carries a display name. */
export interface InvoiceDetail extends Invoice {
  customer: { displayName: string; email: string | null; billingAddress: string };
}

export function getInvoice(brandId: string, id: string): Promise<InvoiceDetail> {
  return apiFetch<InvoiceDetail>(`/brands/${brandId}/invoices/${id}`);
}

/** One row of the Invoice Details screen's "Activity" tab — verbatim off
 * InvoiceEvent, newest first. */
export interface InvoiceActivityEntry {
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string;
  occurredAt: string;
}

export function getInvoiceEvents(brandId: string, id: string): Promise<InvoiceActivityEntry[]> {
  return apiFetch<InvoiceActivityEntry[]>(`/brands/${brandId}/invoices/${id}/events`);
}

/** What the Send/Resend compose modal opens with — subject/body already
 * substituted from the brand's Email Receipt template against this real
 * invoice; `to` is the customer's email on file, or '' if it has none.
 * `layout`/`accentColor` are this brand's saved Email Receipt settings, so
 * the modal's own preview can render the same look sendEmail will actually
 * send, rather than a generic one that ignores what was picked in Brand
 * Settings > Branding. */
export interface InvoiceEmailDraft {
  to: string;
  subject: string;
  body: string;
  layout: EmailReceiptLayout;
  accentColor: string;
}

export function getInvoiceEmailPreview(brandId: string, id: string): Promise<InvoiceEmailDraft> {
  return apiFetch<InvoiceEmailDraft>(`/brands/${brandId}/invoices/${id}/email-preview`);
}

export interface InvoiceEmailSendInput {
  to: string;
  subject: string;
  body: string;
  /** '' (not omitted) means no CC — the compose modal's CC field is blank
   * by default and always sent, same as `to`/`subject`/`body`. */
  cc: string;
  /** The compose modal's "Attach Invoice PDF" checkbox. */
  attachPdf?: boolean;
  /** The compose modal's optional "Preferred payment method" — carried as
   * ?method= on the emailed link so the payment page opens with that tile
   * already selected. */
  preferredMethod?: 'CARD' | 'WALLET' | 'ACH' | 'CHECK';
}

/** The Send/Resend compose modal's actual submit — sends exactly what's on
 * screen (not a status change; issueInvoice owns the draft → sent
 * transition, called separately first when this is a first send). */
export function sendInvoiceEmail(
  brandId: string,
  id: string,
  input: InvoiceEmailSendInput,
): Promise<{ sent: true }> {
  return apiFetch<{ sent: true }>(`/brands/${brandId}/invoices/${id}/send-email`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** The Invoices list's "Bulk Send Invoices" outcome — one id per bucket
 * rather than a single all-or-nothing result, since a batch send genuinely
 * can be partial (see InvoicesService.bulkSend). */
export interface BulkSendResult {
  sent: string[];
  skipped: { id: string; reason: string }[];
  failed: { id: string; reason: string }[];
}

export function bulkSendInvoices(brandId: string, ids: string[]): Promise<BulkSendResult> {
  return apiFetch<BulkSendResult>(`/brands/${brandId}/invoices/bulk-send`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

// --- Payment method settings (FR-PAY-005) -------------------------------------

export interface PaymentMethodSettings {
  cardEnabled: boolean;
  applePayEnabled: boolean;
  googlePayEnabled: boolean;
  achEnabled: boolean;
  checkEnabled: boolean;
}

export function getPaymentMethodSettings(brandId: string): Promise<PaymentMethodSettings> {
  return apiFetch<PaymentMethodSettings>(`/brands/${brandId}/settings/payment-methods`);
}

export function updatePaymentMethodSettings(
  brandId: string,
  input: PaymentMethodSettings,
): Promise<PaymentMethodSettings> {
  return apiFetch<PaymentMethodSettings>(`/brands/${brandId}/settings/payment-methods`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// --- Payment page display (Brand Settings > Branding > Payment Page) --------

export type PaymentPageLayout = 'BANNER' | 'CENTERED' | 'SPLIT';

/** The two colours the Brand Elements panel edits. They live on different
 * tables server-side (themeColor on Brand, accentColor on BrandSettings) but
 * travel with every branding request so one Save is one atomic write — see
 * BrandSettingsService.writeBranding. */
export interface BrandElements {
  themeColor: string;
  accentColor: string;
}

export interface PaymentPageDisplaySettings extends BrandElements {
  paymentPageLayout: PaymentPageLayout;
}

export function getPaymentPageDisplaySettings(
  brandId: string,
): Promise<PaymentPageDisplaySettings> {
  return apiFetch<PaymentPageDisplaySettings>(`/brands/${brandId}/settings/payment-page-display`);
}

export function updatePaymentPageDisplaySettings(
  brandId: string,
  input: PaymentPageDisplaySettings,
): Promise<PaymentPageDisplaySettings> {
  return apiFetch<PaymentPageDisplaySettings>(`/brands/${brandId}/settings/payment-page-display`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// --- Email receipt (Brand Settings > Branding > Email Receipt) --------------

export type EmailReceiptLayout = 'CLASSIC' | 'HERO' | 'MINIMAL';

export interface EmailReceiptSettings extends BrandElements {
  emailReceiptLayout: EmailReceiptLayout;
  emailReceiptSubject: string;
  emailReceiptBody: string;
  /** Read-only: the address these emails actually come from (MAIL_FROM on
   * the API), shown in the preview's sender line. Not part of the write
   * shape below — it is platform configuration, not a brand setting. */
  senderAddress: string;
}

export interface EmailReceiptSettingsInput extends BrandElements {
  emailReceiptLayout: EmailReceiptLayout;
  emailReceiptSubject: string;
  emailReceiptBody: string;
}

export function getEmailReceiptSettings(brandId: string): Promise<EmailReceiptSettings> {
  return apiFetch<EmailReceiptSettings>(`/brands/${brandId}/settings/email-receipt`);
}

export function updateEmailReceiptSettings(
  brandId: string,
  input: EmailReceiptSettingsInput,
): Promise<EmailReceiptSettings> {
  return apiFetch<EmailReceiptSettings>(`/brands/${brandId}/settings/email-receipt`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Actually sends — see BrandSettingsService.sendEmailReceiptTest. Renders
 * the whole draft that is passed in — layout and colours as well as
 * subject/body — not the brand's saved settings, so a draft can be tested
 * before it's saved and the test email matches the preview beside it. */
export function sendEmailReceiptTest(
  brandId: string,
  input: EmailReceiptSettingsInput & { to: string },
): Promise<{ sent: true }> {
  return apiFetch<{ sent: true }>(`/brands/${brandId}/settings/email-receipt/test-send`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// --- Invoice PDF (Brand Settings > Branding > Invoice PDF) -------------------

export type InvoicePdfLayout = 'CLASSIC' | 'MODERN' | 'MINIMAL';
export type InvoicePdfPaymentTerms = 'DUE_ON_RECEIPT' | 'NET_15' | 'NET_30' | 'NET_60';

export interface InvoicePdfSettings extends BrandElements {
  invoicePdfLayout: InvoicePdfLayout;
  showCompanyAddress: boolean;
  showPaymentTerms: boolean;
  showTaxBreakdown: boolean;
  showNotes: boolean;
  /** Resolved server-side, never null — the brand's own displayName/
   * mailingAddress until a merchant overrides it (see BrandSettingsService). */
  companyName: string;
  companyAddress: string;
  paymentTerms: InvoicePdfPaymentTerms;
  notes: string;
}

/** The write shape, distinct from InvoicePdfSettings above: companyName/
 * companyAddress are nullable here (null clears the override back to "use
 * the brand's own record"), where the read response always resolves them
 * to a concrete string. */
export interface InvoicePdfSettingsInput extends BrandElements {
  invoicePdfLayout: InvoicePdfLayout;
  showCompanyAddress: boolean;
  showPaymentTerms: boolean;
  showTaxBreakdown: boolean;
  showNotes: boolean;
  companyName: string | null;
  companyAddress: string | null;
  paymentTerms: InvoicePdfPaymentTerms;
  notes: string;
}

export function getInvoicePdfSettings(brandId: string): Promise<InvoicePdfSettings> {
  return apiFetch<InvoicePdfSettings>(`/brands/${brandId}/settings/invoice-pdf`);
}

export function updateInvoicePdfSettings(
  brandId: string,
  input: InvoicePdfSettingsInput,
): Promise<InvoicePdfSettings> {
  return apiFetch<InvoicePdfSettings>(`/brands/${brandId}/settings/invoice-pdf`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// --- Stripe Connect (one connected account per brand) ------------------------

/**
 * Where to send the browser to start the Connect handshake.
 *
 * A route on THIS origin, deliberately — not the API. The API's connect
 * endpoint is authenticated, and a top-level browser navigation carries no
 * Authorization header; in this BFF the browser holds no API session at all,
 * since the token lives in an httpOnly cookie here and is only ever replayed
 * server-side. Linking straight at the API arrives unauthenticated and 401s.
 * The route handler attaches the token and forwards the redirect to Stripe.
 *
 * Status and disconnect for Stripe itself go through the same
 * listPaymentGateways / disconnectPaymentGateway calls every other gateway
 * uses below — only the connect leg is Stripe-specific, since it alone
 * completes a real OAuth authorisation.
 */
export function stripeConnectUrl(brandId: string): string {
  return `/settings/stripe/connect?brandId=${encodeURIComponent(brandId)}`;
}

/** Same BFF-redirect shape as stripeConnectUrl, for Square Connect. */
export function squareConnectUrl(brandId: string): string {
  return `/settings/square/connect?brandId=${encodeURIComponent(brandId)}`;
}

// --- Payment gateways (Brand Settings > Payment Gateways) --------------------

export type PaymentGatewayProvider = 'STRIPE' | 'PAYPAL' | 'SQUARE' | 'AUTHORIZE_NET';

export interface PaymentGatewaySummary {
  provider: PaymentGatewayProvider;
  displayName: string;
  connected: boolean;
  /** Stripe/Square's own account label, or Authorize.net's masked API Login
   * ID; null for PayPal, which has no handshake of its own yet. */
  accountLabel: string | null;
  connectedAt: string | null;
}

export function listPaymentGateways(brandId: string): Promise<PaymentGatewaySummary[]> {
  return apiFetch<PaymentGatewaySummary[]>(`/brands/${brandId}/integrations/gateways`);
}

/** PayPal only — Stripe and Square connect through their own OAuth redirect
 * (stripeConnectUrl / squareConnectUrl) and Authorize.net through
 * connectAuthorizeNet's credential form instead. */
export function connectPaymentGateway(
  brandId: string,
  provider: Extract<PaymentGatewayProvider, 'PAYPAL'>,
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/brands/${brandId}/integrations/gateways/${provider}/connect`, {
    method: 'POST',
  });
}

/** Any of the four — dispatches to the right provider's own disconnect
 * server-side (Stripe's deauthorisation, Square's token revoke, or a plain
 * status flip for PayPal/Authorize.net). */
export function disconnectPaymentGateway(
  brandId: string,
  provider: PaymentGatewayProvider,
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/brands/${brandId}/integrations/gateways/${provider}/disconnect`, {
    method: 'POST',
  });
}

export interface AuthorizeNetConnectInput {
  apiLoginId: string;
  transactionKey: string;
  environment: 'sandbox' | 'production';
}

/** Authorize.net has no consent screen to redirect to — this posts the
 * brand's own API Login ID and Transaction Key, which the API verifies
 * against Authorize.net before storing anything. */
export function connectAuthorizeNet(
  brandId: string,
  input: AuthorizeNetConnectInput,
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/brands/${brandId}/integrations/authorize-net/connect`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// --- Transaction log (Brand Settings > Payment Gateways) --------------------

/** One settled-or-attempted charge. Not scoped to any one gateway — see the
 * API's PaymentsService.list for why switching gateways must not make this
 * history disappear. */
export interface PaymentTransaction {
  id: string;
  invoiceNumber: string;
  customerName: string;
  method: 'CARD' | 'WALLET' | 'ACH' | 'CHECK' | 'MANUAL';
  amountMinor: number;
  currency: string;
  status:
    | 'INITIATED'
    | 'PROCESSING'
    | 'SETTLED'
    | 'FAILED'
    | 'REFUNDED'
    | 'PARTIALLY_REFUNDED'
    | 'CANCELLED';
  createdAt: string;
  settledAt: string | null;
}

export interface PaymentTransactionListResponse {
  data: PaymentTransaction[];
  page: number;
  pageSize: number;
  total: number;
}

export function listPaymentTransactions(
  brandId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<PaymentTransactionListResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<PaymentTransactionListResponse>(`/brands/${brandId}/payments${suffix}`);
}

// --- Zoho integration (FR-ZHO) ------------------------------------------------

export interface ZohoConnectionStatus {
  connected: boolean;
  organizationName: string | null;
  lastSyncAt: string | null;
  lastPulledAt: string | null;
  health: string | null;
  pullFrequencyMinutes: number;
  customerSyncEnabled: boolean;
  invoiceSyncEnabled: boolean;
}

export function getZohoStatus(brandId: string): Promise<ZohoConnectionStatus> {
  return apiFetch<ZohoConnectionStatus>(`/brands/${brandId}/integrations/zoho/status`);
}

/** Mirrors zohoSyncSettingsSchema — every field optional, at least one
 * required. Applied the moment a control changes; there is no batching
 * "Save" step for this to accumulate into. */
export interface ZohoSyncSettingsPatch {
  pullFrequencyMinutes?: 1 | 15 | 60 | 1440;
  customerSyncEnabled?: boolean;
  invoiceSyncEnabled?: boolean;
}

export function updateZohoSyncSettings(
  brandId: string,
  patch: ZohoSyncSettingsPatch,
): Promise<ZohoConnectionStatus> {
  return apiFetch<ZohoConnectionStatus>(`/brands/${brandId}/integrations/zoho/settings`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Local-only: Zoho has no adapter-level revoke call (see
 * IntegrationConnectionService.disconnectZoho) — this clears the stored
 * credentials so nothing pushes or pulls for this brand again. */
export function disconnectZoho(brandId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/brands/${brandId}/integrations/zoho/disconnect`, {
    method: 'POST',
  });
}

export interface ZohoActivityEntry {
  direction: 'PUSH' | 'PULL';
  objectType: string;
  objectId: string | null;
  status: string;
  errorClass: string | null;
  lastError: string | null;
  updatedAt: string;
}

export function getZohoActivity(brandId: string): Promise<ZohoActivityEntry[]> {
  return apiFetch<ZohoActivityEntry[]>(`/brands/${brandId}/integrations/zoho/activity`);
}

// --- Zoho Books Sandbox (config testing on the connected org) ----------------
//
// Not a separate test environment with its own credentials — see
// ZohoSandboxService's doc comment on the API side. These calls ride the same
// brand's existing Zoho connection.

export interface ZohoSandbox {
  sandboxId: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface ZohoSandboxChange {
  changeId: string;
  componentId: string;
  componentName: string;
  action: string;
  deploymentStatus: string;
  module: string;
  createdAt: string | null;
  lastModifiedAt: string | null;
}

export function listZohoSandboxes(brandId: string): Promise<ZohoSandbox[]> {
  return apiFetch<ZohoSandbox[]>(`/brands/${brandId}/integrations/zoho/sandboxes`);
}

export function createZohoSandbox(brandId: string, name?: string): Promise<ZohoSandbox> {
  return apiFetch<ZohoSandbox>(`/brands/${brandId}/integrations/zoho/sandboxes`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function deleteZohoSandbox(brandId: string, sandboxId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/brands/${brandId}/integrations/zoho/sandboxes/${sandboxId}`, {
    method: 'DELETE',
  });
}

export function setZohoSandboxActive(
  brandId: string,
  sandboxId: string,
  active: boolean,
): Promise<ZohoSandbox> {
  return apiFetch<ZohoSandbox>(
    `/brands/${brandId}/integrations/zoho/sandboxes/${sandboxId}/activation`,
    { method: 'PATCH', body: JSON.stringify({ active }) },
  );
}

export function rebuildZohoSandbox(brandId: string, sandboxId: string): Promise<ZohoSandbox> {
  return apiFetch<ZohoSandbox>(
    `/brands/${brandId}/integrations/zoho/sandboxes/${sandboxId}/rebuild`,
    { method: 'POST' },
  );
}

export function getZohoSandboxChanges(
  brandId: string,
  sandboxId: string,
  target: 'sandbox' | 'production',
): Promise<ZohoSandboxChange[]> {
  return apiFetch<ZohoSandboxChange[]>(
    `/brands/${brandId}/integrations/zoho/sandboxes/${sandboxId}/changes?target=${target}`,
  );
}

/** Read-only — reports what a real push would do, without doing it. */
export function validateZohoSandboxPush(brandId: string, sandboxId: string): Promise<unknown> {
  return apiFetch<unknown>(
    `/brands/${brandId}/integrations/zoho/sandboxes/${sandboxId}/push/validate`,
    { method: 'POST' },
  );
}

/** The one call in this file that can change the brand's real production
 * Zoho org — the API refuses this without `confirm: true`, and the panel
 * only ever calls it from behind its own explicit confirmation dialog. */
export function pushZohoSandboxToProduction(brandId: string, sandboxId: string): Promise<unknown> {
  return apiFetch<unknown>(`/brands/${brandId}/integrations/zoho/sandboxes/${sandboxId}/push`, {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  });
}

// --- Dashboard --------------------------------------------------------------

/** A resolved date-range preset (see lib/date-range.ts), as concrete bounds
 * ready for the wire — `undefined` lets the API fall back to its own
 * default (the current calendar month). */
export interface DashboardRange {
  start: Date;
  end: Date;
}

/** `null` means "All Brands" — every dashboard endpoint below omits the
 * query param entirely in that case, which is what makes the backend widen
 * to every brand the caller's role can read (see DashboardController). */
function dashboardQuery(brandId: string | null, range?: DashboardRange): string {
  const params = new URLSearchParams();
  if (brandId) params.set('brandId', brandId);
  if (range) {
    params.set('from', range.start.toISOString());
    params.set('to', range.end.toISOString());
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface DashboardSummary {
  currency: string;
  invoicedMinor: number;
  collectedMinor: number;
  /** 0..1 */
  collectionRate: number;
  overdueMinor: number;
  otherCurrencyBrandCount: number;
}

export function getDashboardSummary(
  brandId: string | null,
  range?: DashboardRange,
): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>(`/dashboard/summary${dashboardQuery(brandId, range)}`);
}

export interface DashboardTrendPoint {
  month: string;
  label: string;
  invoicedMinor: number;
  collectedMinor: number;
  collectionRate: number;
}

export function getDashboardTrend(brandId: string | null): Promise<DashboardTrendPoint[]> {
  return apiFetch<DashboardTrendPoint[]>(`/dashboard/trend${dashboardQuery(brandId)}`);
}

export type DashboardStatusBucketName = 'Paid' | 'Unpaid' | 'Overdue' | 'Partially Paid' | 'Draft';

export interface DashboardStatusBucket {
  bucket: DashboardStatusBucketName;
  amountMinor: number;
  /** 0..1 */
  percent: number;
}

export function getDashboardStatusBreakdown(
  brandId: string | null,
): Promise<DashboardStatusBucket[]> {
  return apiFetch<DashboardStatusBucket[]>(`/dashboard/status-breakdown${dashboardQuery(brandId)}`);
}

export interface TopOverdueCustomer {
  customerId: string;
  displayName: string;
  brandId: string;
  brandName: string | null;
  balanceMinor: number;
  daysOverdue: number;
}

export function getDashboardTopOverdueCustomers(
  brandId: string | null,
): Promise<TopOverdueCustomer[]> {
  return apiFetch<TopOverdueCustomer[]>(
    `/dashboard/top-overdue-customers${dashboardQuery(brandId)}`,
  );
}

export type NeedsAttentionKind = 'STALE_DRAFT' | 'DUE_SOON' | 'SYNC_FAILED';

export interface NeedsAttentionItem {
  kind: NeedsAttentionKind;
  brandId: string;
  brandName: string | null;
  invoiceNumber: string | null;
  subject: string;
  detail: string;
  invoiceId: string | null;
  syncJobId: string | null;
  occurredAt: string;
}

export interface NeedsAttentionResult {
  items: NeedsAttentionItem[];
  totalCount: number;
}

export function getDashboardNeedsAttention(brandId: string | null): Promise<NeedsAttentionResult> {
  return apiFetch<NeedsAttentionResult>(`/dashboard/needs-attention${dashboardQuery(brandId)}`);
}

export type RecentActivityKind =
  'PAYMENT_RECEIVED' | 'INVOICE_SENT' | 'CUSTOMER_ADDED' | 'CUSTOMER_UPDATED';

export interface RecentActivityItem {
  kind: RecentActivityKind;
  brandId: string;
  brandName: string | null;
  brandThemeColor: string;
  brandInitial: string;
  message: string;
  occurredAt: string;
}

export function getDashboardRecentActivity(brandId: string | null): Promise<RecentActivityItem[]> {
  return apiFetch<RecentActivityItem[]>(`/dashboard/recent-activity${dashboardQuery(brandId)}`);
}

export interface BrandRollup {
  brandId: string;
  brandName: string;
  themeColor: string;
  currency: string;
  invoicedMinor: number;
  collectedMinor: number;
  collectionRate: number;
  overdueMinor: number;
}

/** Only meaningful in All Brands mode. */
export function getDashboardByBrand(range?: DashboardRange): Promise<BrandRollup[]> {
  return apiFetch<BrandRollup[]>(`/dashboard/by-brand${dashboardQuery(null, range)}`);
}

export interface CrossBrandCustomerRow {
  email: string;
  displayName: string;
  perBrand: Record<string, { brandName: string; status: string | null }>;
}

export interface CrossBrandCustomersResult {
  rows: CrossBrandCustomerRow[];
  matchedCount: number;
}

/** Only meaningful in All Brands mode. */
export function getDashboardCrossBrandCustomers(): Promise<CrossBrandCustomersResult> {
  return apiFetch<CrossBrandCustomersResult>('/dashboard/cross-brand-customers');
}

export function retrySyncJob(jobId: string): Promise<{ queued: true }> {
  return apiFetch<{ queued: true }>(`/dashboard/sync-jobs/${jobId}/retry`, { method: 'POST' });
}

export interface DashboardIntegrationsStatus {
  connected: boolean;
  lastSyncAt: string | null;
}

/** One signal for both single-brand and All Brands mode — see
 * DashboardService.getIntegrationsStatus for why a per-brand Zoho-only call
 * isn't enough once "All Brands" is on the table. */
export function getDashboardIntegrationsStatus(
  brandId: string | null,
): Promise<DashboardIntegrationsStatus> {
  return apiFetch<DashboardIntegrationsStatus>(
    `/dashboard/integrations-status${dashboardQuery(brandId)}`,
  );
}

export { API_URL };
