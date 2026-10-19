import { cookies } from 'next/headers';
import { RETURN_TO_PARAM, SESSION_COOKIE } from '@platform/platform-contracts';

/**
 * The admin app's half of FR-AUTH-001.
 *
 * People sign in on Accounts (apps/accounts), which stores the API's session
 * token in the platform's shared httpOnly cookie. This app reads that same
 * cookie and replays the token upstream from the server on every request, so
 * one sign-in opens every product. The token never reaches the browser — no
 * script on this page can read it, so an XSS bug cannot lift a session out of
 * it.
 */
export { RETURN_TO_PARAM, SESSION_COOKIE };

/**
 * Where an unauthenticated request is sent. A path on this app: middleware
 * forwards it to Accounts (see middleware.ts), so every existing redirect to
 * it keeps working.
 */
export const LOGIN_PATH = '/login';

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** Clears the shared cookie — which signs the user out of every product. */
export async function clearSessionToken(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { path: '/', maxAge: 0, ...cookieDomain() });
}

/** Set in production so the shared cookie covers every app's subdomain. */
function cookieDomain(): { domain?: string } {
  const domain = process.env['COOKIE_DOMAIN']?.trim();
  return domain ? { domain } : {};
}

/** Accounts: sign-in, team, billing and the product launcher. */
export const ACCOUNTS_URL = process.env['NEXT_PUBLIC_ACCOUNTS_URL'] || 'http://localhost:3002';
