import { NextResponse, type NextRequest } from 'next/server';

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
 * What this does buy is that an unauthenticated request never renders a page or
 * spends a server round trip discovering it should not have.
 */
const SESSION_COOKIE = 'fenwick_admin_session';
/**
 * Reachable with no session at all.
 *
 * `/welcome` is the public marketing page — without it here an anonymous
 * visitor is bounced to /login and the product has no front door.
 *
 * `/set-password` is here because the emailed signup link carries a one-time
 * token instead of a session; the page itself still turns away anyone arriving
 * with neither. Bouncing it to /login would make the link useless — the
 * recipient has no password yet, which is the entire reason they are here.
 *
 * `/terms` and `/privacy` are linked from the sign-up form, which by
 * definition is filled out by someone with no session yet.
 */
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/check-inbox',
  '/set-password',
  '/welcome',
  '/terms',
  '/privacy',
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const target = request.nextUrl.clone();
  target.pathname = '/login';
  target.search = '';
  // So the user lands where they were going, not on the dashboard. Read back
  // through safeReturnPath, which refuses anything that is not a local path.
  if (pathname !== '/') target.searchParams.set('next', `${pathname}${search}`);

  return NextResponse.redirect(target);
}

export const config = {
  // Static assets carry no session and need no redirect. `_next/*` in
  // particular must stay out, or the login page loads without its own CSS.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
