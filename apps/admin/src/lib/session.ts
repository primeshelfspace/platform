import { cookies, headers } from 'next/headers';

/**
 * The admin app's half of FR-AUTH-001.
 *
 * The API issues the session token; this app stores it in its OWN httpOnly
 * cookie, on its own origin, and replays it upstream from the server on every
 * request. It cannot simply reuse the cookie the API sets: that cookie belongs
 * to the API's origin, and making it readable here would mean SameSite=None,
 * which requires HTTPS and so cannot work in local development at all.
 *
 * The practical consequence is the useful one — the token never reaches the
 * browser. No script on this page can read it, so an XSS bug cannot lift a
 * session out of it.
 */
export const SESSION_COOKIE = 'fenwick_admin_session';

/** Where an unauthenticated request is sent, and the key it comes back on. */
export const LOGIN_PATH = '/login';
export const RETURN_TO_PARAM = 'next';

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
  });
}

/**
 * Whether *this* request actually arrived over HTTPS — mirrors the API's own
 * `request.secure` (apps/api/src/auth/auth.controller.ts). `NODE_ENV ===
 * 'production'` used to stand in for this and is wrong: a production build
 * served over plain HTTP (e.g. hitting an EC2 box directly by IP, no TLS
 * reverse proxy yet) would still mark the cookie Secure, and the browser
 * silently discards a Secure cookie set over a non-HTTPS origin — every
 * request after that one looks unauthenticated and sign-in loops forever.
 *
 * `x-forwarded-proto` is the standard signal a TLS-terminating proxy/load
 * balancer sets (Vercel, an ALB, nginx, Cloudflare all do). No proxy means no
 * header, which we take as "not HTTPS" rather than guessing from build mode.
 * `COOKIE_SECURE` is an explicit escape hatch for the rare setup where Next
 * itself terminates TLS with nothing in front of it to set the header.
 */
async function isSecureRequest(): Promise<boolean> {
  const override = process.env['COOKIE_SECURE'];
  if (override !== undefined) return override === 'true';

  const forwardedProto = (await headers()).get('x-forwarded-proto');
  return forwardedProto?.split(',')[0]?.trim().toLowerCase() === 'https';
}

export async function clearSessionToken(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Keeps an open redirect out of the sign-in flow: only a path on this origin is
 * ever followed, never an absolute URL someone appended to the query string.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
