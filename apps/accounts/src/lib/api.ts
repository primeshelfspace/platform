/**
 * Accounts' connection to the API. Every call runs on the server and replays
 * the session token from the shared cookie as a bearer token — the same
 * back-end-for-front-end shape as the invoicing app (see its lib/api.ts).
 */

import type {
  LocationKind,
  LocationStatus,
  PermissionGrants,
  Product,
  Role,
} from '@platform/platform-contracts';
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

/** The session is gone (expired, revoked, signed out elsewhere). */
export class SessionExpiredError extends ApiError {
  constructor(message = 'session expired') {
    super(401, message);
    this.name = 'SessionExpiredError';
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...requestInit } = init;
  // An explicit token is passed by sign-in, which runs before its cookie exists.
  const sessionToken = token === undefined ? await readSessionToken() : token;

  const response = await fetch(`${API_URL}${path}`, {
    ...requestInit,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...requestInit.headers,
    },
    cache: 'no-store',
  });

  const text = await response.text();
  const body = text ? safeJson(text) : null;

  if (!response.ok) {
    const raw = (body as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(raw)
      ? raw.join(', ')
      : (raw ?? `${response.status} ${response.statusText}`);
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

// --- Authentication ----------------------------------------------------------

export interface UserProduct {
  product: Product;
  name: string;
  role: string;
}

export interface CurrentUser {
  id: string;
  merchantId: string;
  email: string;
  name: string;
  role: Role;
  assignedBrandIds: string[];
  mustResetPassword: boolean;
  permissions: PermissionGrants;
  allBrands: boolean;
  assignableRoles: Role[];
  /** Products this user can open (subscribed and holding a role). */
  products: UserProduct[];
  assignedLocationIds: string[];
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: CurrentUser;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    token: null,
  });
}

export function register(fullName: string, email: string): Promise<{ ok: true }> {
  return apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ fullName, email }),
    token: null,
  });
}

export function setPasswordWithToken(token: string, newPassword: string): Promise<LoginResponse> {
  return apiFetch('/auth/set-password/token', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
    token: null,
  });
}

export function requestPasswordReset(email: string): Promise<{ ok: true }> {
  return apiFetch('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
    token: null,
  });
}

export function setPassword(newPassword: string): Promise<{ ok: true }> {
  return apiFetch('/auth/set-password', {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
}

export function logout(): Promise<void> {
  return apiFetch('/auth/logout', { method: 'POST' });
}

export function getCurrentUser(): Promise<CurrentUser> {
  return apiFetch('/auth/me');
}

// --- Team --------------------------------------------------------------------

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  assignedBrandIds: string[];
  productRoles: Partial<Record<Product, string>>;
  assignedLocationIds: string[];
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function listUsers(): Promise<Page<ManagedUser>> {
  return apiFetch('/users?page=1&pageSize=100');
}

export function inviteUser(input: {
  name: string;
  email: string;
  role: Role;
  brandIds: string[];
  productRoles?: Partial<Record<Product, string>>;
}): Promise<ManagedUser> {
  return apiFetch('/users/invite', { method: 'POST', body: JSON.stringify(input) });
}

export function updateProductRole(
  userId: string,
  product: Product,
  role: string | null,
): Promise<ManagedUser> {
  return apiFetch(`/users/${userId}/product-roles/${product}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export function updateUserBrands(userId: string, brandIds: string[]): Promise<ManagedUser> {
  return apiFetch(`/users/${userId}/brands`, {
    method: 'PUT',
    body: JSON.stringify({ brandIds }),
  });
}

export function updateUserLocations(userId: string, locationIds: string[]): Promise<ManagedUser> {
  return apiFetch(`/users/${userId}/locations`, {
    method: 'PUT',
    body: JSON.stringify({ locationIds }),
  });
}

export function updateUserStatus(
  userId: string,
  status: 'ACTIVE' | 'SUSPENDED',
): Promise<ManagedUser> {
  return apiFetch(`/users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// --- Brands ------------------------------------------------------------------

export interface Brand {
  id: string;
  legalName: string;
  displayName: string;
  currency: string;
  timezone: string;
  themeColor: string;
  status: 'ACTIVE' | 'ARCHIVED';
  logoUrl: string | null;
}

export function listBrands(): Promise<Brand[]> {
  return apiFetch('/brands');
}

// --- Locations ---------------------------------------------------------------

export interface Location {
  id: string;
  brandId: string | null;
  name: string;
  kind: LocationKind;
  status: LocationStatus;
  createdAt: string;
}

export function listLocations(): Promise<Location[]> {
  return apiFetch('/locations');
}

export function createLocation(input: {
  name: string;
  kind: LocationKind;
  brandId: string | null;
}): Promise<Location> {
  return apiFetch('/locations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateLocation(
  id: string,
  input: Partial<{
    name: string;
    kind: LocationKind;
    brandId: string | null;
    status: LocationStatus;
  }>,
): Promise<Location> {
  return apiFetch(`/locations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

// --- Billing -----------------------------------------------------------------

export interface ProductSubscription {
  product: Product;
  status: 'ACTIVE' | 'CANCELLED' | 'NONE';
  plan: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export function listSubscriptions(): Promise<ProductSubscription[]> {
  return apiFetch('/company/subscriptions');
}

export function updateSubscription(
  product: Product,
  status: 'ACTIVE' | 'CANCELLED',
): Promise<ProductSubscription> {
  return apiFetch(`/company/subscriptions/${product}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export function getUser(userId: string): Promise<ManagedUser> {
  return apiFetch(`/users/${userId}`);
}
