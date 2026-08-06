import { NextResponse, type NextRequest } from 'next/server';
import { API_URL } from './api';
import { LOGIN_PATH, readSessionToken } from './session';

/**
 * Starts a provider OAuth handshake from the admin app.
 *
 * The API's connect endpoints are authenticated (@RequirePermission) and answer
 * with a redirect to the provider's consent screen. A browser's top-level
 * navigation cannot carry an Authorization header — and in this BFF the browser
 * has no API session at all, since the token lives in an httpOnly cookie on
 * THIS origin and is only ever replayed server-side. Pointing a link straight
 * at the API therefore arrives unauthenticated and 401s.
 *
 * So the redirect is fetched here, where the token can be attached, and
 * re-issued to the browser as a plain redirect to the provider, which needs no
 * credentials of ours.
 */
export async function startProviderConnect(
  request: NextRequest,
  options: {
    /** Path segment on the API: `zoho` or `stripe`. */
    readonly provider: string;
    /** Where to send the browser back to when something goes wrong. */
    readonly settingsPath: string;
    /** Query key the destination page reads its failure from. Pages differ:
     * the Zoho screen owns the whole page and uses `error`, while the Stripe
     * panel is one section of the payment-methods screen and namespaces its
     * own as `stripeError`. */
    readonly errorParam?: string;
  },
): Promise<NextResponse> {
  const { provider, settingsPath, errorParam = 'error' } = options;
  const brandId = request.nextUrl.searchParams.get('brandId');

  const failure = (reason: string, withBrand = true) => {
    const params = new URLSearchParams();
    if (withBrand && brandId) params.set('brandId', brandId);
    params.set(errorParam, reason);
    return NextResponse.redirect(new URL(`${settingsPath}?${params}`, request.url));
  };

  if (!brandId) return failure('missing_brand', false);

  const token = await readSessionToken();
  if (!token) return NextResponse.redirect(new URL(LOGIN_PATH, request.url));

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/brands/${brandId}/integrations/${provider}/connect`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return failure('api_unreachable');
  }

  const location = upstream.headers.get('location');
  if (!location) {
    // No redirect means the API refused rather than handing us a consent URL —
    // most often the provider is not configured on this deployment, which
    // surfaces as a 400 carrying the reason.
    let reason = 'connect_failed';
    try {
      const body = (await upstream.json()) as { message?: string };
      if (body?.message) reason = body.message;
    } catch {
      // Non-JSON body; the generic reason above stands.
    }
    return failure(reason);
  }

  return NextResponse.redirect(location);
}
