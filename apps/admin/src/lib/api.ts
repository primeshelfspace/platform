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

import type { BusinessType } from '@fenwick/shared';
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

/** Brand Setup's "Brand Details" tab. Full replace, same shape as
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

export interface CustomerListResponse {
  data: Customer[];
  page: number;
  pageSize: number;
  total: number;
}

export function listCustomers(
  brandId: string,
  params: { search?: string } = {},
): Promise<CustomerListResponse> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<CustomerListResponse>(`/brands/${brandId}/customers${suffix}`);
}

export function getCustomer(brandId: string, id: string): Promise<Customer> {
  return apiFetch<Customer>(`/brands/${brandId}/customers/${id}`);
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
  status: string;
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
  lineItems: LineItem[];
}

export interface InvoiceListResponse {
  data: Invoice[];
  page: number;
  pageSize: number;
  total: number;
}

export function listInvoices(
  brandId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<InvoiceListResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
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

// --- Stripe Connect (one connected account per brand) ------------------------

export interface StripeAccountStatus {
  connected: boolean;
  /** The connected account id (acct_…). Not a secret. */
  accountId: string | null;
  /** What Stripe knows this business as; null until Stripe onboarding finishes. */
  displayName: string | null;
  /** False while Stripe is still collecting details — linked, but cannot yet
   * accept a live charge. */
  chargesEnabled: boolean;
}

export function getStripeAccountStatus(brandId: string): Promise<StripeAccountStatus> {
  return apiFetch<StripeAccountStatus>(`/brands/${brandId}/integrations/stripe/status`);
}

/**
 * Where to send the browser to start the Connect handshake.
 *
 * A route on THIS origin, deliberately — not the API. The API's connect
 * endpoint is authenticated, and a top-level browser navigation carries no
 * Authorization header; in this BFF the browser holds no API session at all,
 * since the token lives in an httpOnly cookie here and is only ever replayed
 * server-side. Linking straight at the API arrives unauthenticated and 401s.
 * The route handler attaches the token and forwards the redirect to Stripe.
 */
export function stripeConnectUrl(brandId: string): string {
  return `/settings/stripe/connect?brandId=${encodeURIComponent(brandId)}`;
}

/** Revokes the platform's authorisation at Stripe and clears the connection. */
export function disconnectStripe(brandId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/brands/${brandId}/integrations/stripe/disconnect`, {
    method: 'POST',
  });
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

export { API_URL };
