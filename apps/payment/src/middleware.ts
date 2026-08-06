import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Per-request CSP with a nonce (TDD-001 §3.3, §15.3).
 *
 * `'strict-dynamic'` plus a fresh nonce lets Next's own inline bootstrap
 * scripts run (and, transitively, whatever they load — webpack chunks,
 * Stripe.js's own dynamically-injected sub-scripts) without falling back to
 * `'unsafe-inline'`, which is what the previous static CSP effectively
 * required and never had. `'self'`/host lists in script-src are ignored by
 * browsers that support `strict-dynamic`; they remain only as a fallback for
 * browsers that do not.
 *
 * Card entry itself still never touches this app's code or servers — Stripe
 * Elements renders inside an iframe served from js.stripe.com, which is why
 * frame-src/connect-src (not script-src alone) must name Stripe's origins
 * explicitly.
 */
const gatewayOrigin = process.env.NEXT_PUBLIC_GATEWAY_ORIGIN ?? '';
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
/**
 * Where brand logos are served from. `img-src 'self'` alone blocks them the
 * moment STORAGE_DRIVER=s3, because a presigned URL points at the bucket's own
 * origin — the logo simply never appears, with only a console entry to say why.
 * Empty when logos are served locally, which 'self' already covers.
 */
const assetOrigin = process.env.NEXT_PUBLIC_ASSET_ORIGIN ?? '';
const isDev = process.env.NODE_ENV !== 'production';

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${gatewayOrigin ? ` ${gatewayOrigin}` : ''}${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${assetOrigin ? ` ${assetOrigin}` : ''}`,
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin} https://api.stripe.com${gatewayOrigin ? ` ${gatewayOrigin}` : ''}${isDev ? ' ws: wss:' : ''}`,
    `frame-src https://js.stripe.com https://hooks.stripe.com${gatewayOrigin ? ` ${gatewayOrigin}` : ''}`,
    'upgrade-insecure-requests',
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimization, which don't
    // render HTML and don't need a nonce.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
