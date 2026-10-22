/**
 * One sign-in for every web app (architecture plan, phase 2).
 *
 * Accounts signs the user in and stores the API's session token in this
 * httpOnly cookie. Every product web app reads the same cookie and replays
 * the token to the API, so signing in once opens every product.
 *
 * Locally all apps run on `localhost` (different ports), and browsers share
 * cookies across ports, so a host-only cookie is enough. In production the
 * apps live on subdomains (accounts.example.com, invoicing.example.com), so
 * COOKIE_DOMAIN must be set to the parent domain (`.example.com`).
 */
export const SESSION_COOKIE = 'platform_session';

/** The query parameter a sign-in page uses to send the user back afterwards. */
export const RETURN_TO_PARAM = 'next';

/**
 * Where to send the user after sign-in, if it is safe: a path on the current
 * app, or an absolute URL on one of the platform's own web apps. Anything
 * else (another site, `//evil.example`) falls back to `fallback`, which keeps
 * an open redirect out of the sign-in flow.
 */
export function safeReturnTo(
  value: string | null | undefined,
  allowedOrigins: readonly string[],
  fallback = '/',
): string {
  if (!value) return fallback;
  if (value.startsWith('/')) {
    // A path on this app. Browsers read a backslash as a slash and ignore
    // tabs and newlines, so `/\evil.example` and `/<tab>/evil.example` would
    // leave the site just like `//evil.example` — resolve it against a
    // placeholder origin and keep it only if it stays there.
    // eslint-disable-next-line no-control-regex
    if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
    try {
      const base = 'https://return-to.invalid';
      const url = new URL(value, base);
      return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
    } catch {
      return fallback;
    }
  }
  try {
    const url = new URL(value);
    return allowedOrigins.some((origin) => sameOrigin(origin, url)) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function sameOrigin(origin: string, url: URL): boolean {
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}
