import { cookies, headers } from 'next/headers';
import { SESSION_COOKIE, safeReturnTo } from '@platform/platform-contracts';
import { APP_ORIGINS } from './products';

/**
 * Accounts is where people sign in. The API issues the session token; this
 * app stores it in the platform's shared httpOnly cookie and replays it to the
 * API from the server. Every product web app reads the same cookie, so one
 * sign-in here opens all of them (see @platform/platform-contracts session.ts).
 * The token never reaches browser scripts.
 */
export { SESSION_COOKIE };

export const LOGIN_PATH = '/login';

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function writeSessionToken(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isSecureRequest(),
    expires: expiresAt,
    path: '/',
    ...cookieDomain(),
  });
}

export async function clearSessionToken(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { path: '/', maxAge: 0, ...cookieDomain() });
}

/** Set in production so the cookie covers every app's subdomain. */
function cookieDomain(): { domain?: string } {
  const domain = process.env['COOKIE_DOMAIN']?.trim();
  return domain ? { domain } : {};
}

/**
 * Whether this request arrived over HTTPS, from the TLS proxy's
 * x-forwarded-proto (same reasoning as the invoicing app's session.ts).
 * COOKIE_SECURE overrides it for a setup with no proxy in front.
 */
async function isSecureRequest(): Promise<boolean> {
  const override = process.env['COOKIE_SECURE'];
  if (override !== undefined) return override === 'true';
  const forwardedProto = (await headers()).get('x-forwarded-proto');
  return forwardedProto?.split(',')[0]?.trim().toLowerCase() === 'https';
}

/** A path here, or a URL on one of the platform's web apps — nothing else. */
export function safeReturnPath(value: string | null | undefined): string {
  return safeReturnTo(value, APP_ORIGINS);
}
