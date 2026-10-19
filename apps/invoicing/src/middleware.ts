import { NextResponse, type NextRequest } from 'next/server';
import { RETURN_TO_PARAM, SESSION_COOKIE } from '@platform/platform-contracts';

/**
 * FR-AUTH-021: no page of this app is reachable without a session.
 *
 * This is the cheap filter, not the access decision. It only asks whether a
 * session cookie is present — middleware runs on the edge runtime with no
 * database and no API round trip, so it cannot tell a live session from an
 * expired one. The real check is in (app)/layout.tsx, which asks the API, and
 * behind that the API's own guard, which is the only one that actually enforces
 * anything (hiding a page is not access control).
 *
 * Signing in, signing up and passwords live in Accounts (apps/accounts) and
 * share one session cookie with this app. Those paths are forwarded there, so
 * every redirect to /login or /set-password in this app keeps working, and the
 * user comes back to the page they were on afterwards.
 */
const ACCOUNTS_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/check-inbox',
  '/set-password',
  '/terms',
  '/privacy',
];

/**
 * Reachable with no session at all. `/welcome` is the public marketing page —
 * without it here an anonymous visitor has no front door.
 */
const PUBLIC_PATHS = ['/welcome'];

// Literal names, so Next inlines them into the edge bundle at build time.
const ACCOUNTS_URL = process.env.NEXT_PUBLIC_ACCOUNTS_URL || 'http://localhost:3002';
const APP_URL = process.env.NEXT_PUBLIC_INVOICING_URL || '';

const matches = (pathname: string, paths: readonly string[]) =>
  paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const appOrigin = APP_URL || request.nextUrl.origin;

  if (matches(pathname, ACCOUNTS_PATHS)) {
    const target = new URL(`${pathname}${search}`, ACCOUNTS_URL);
    // A return path is relative to this app; make it absolute so Accounts
    // can send the user back here rather than to one of its own pages.
    const next = target.searchParams.get(RETURN_TO_PARAM);
    if (next?.startsWith('/') && !next.startsWith('//')) {
      target.searchParams.set(RETURN_TO_PARAM, new URL(next, appOrigin).toString());
    }
    return NextResponse.redirect(target);
  }

  if (matches(pathname, PUBLIC_PATHS) || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const login = new URL('/login', ACCOUNTS_URL);
  login.searchParams.set(RETURN_TO_PARAM, new URL(`${pathname}${search}`, appOrigin).toString());
  return NextResponse.redirect(login);
}

export const config = {
  // Static assets carry no session and need no redirect. `_next/*` in
  // particular must stay out, or pages load without their own CSS.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
