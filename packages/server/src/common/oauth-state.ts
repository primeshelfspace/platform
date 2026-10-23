import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The OAuth `state` parameter, self-verifying rather than looked up
 * server-side. A provider's redirect back to our callback is a fresh,
 * unauthenticated browser request — no session cookie can be relied on to
 * say which brand initiated this, or that this callback was not forged. HMAC
 * signing the brandId (and an issued-at bound to a short window) answers
 * both without a Redis key to manage and expire.
 *
 * Provider-neutral: Zoho Books, Stripe Connect and Square Connect all redirect
 * through here. The provider is part of the signed payload rather than
 * assumed, so a state minted for one provider's consent screen cannot be
 * replayed against another's callback — connecting an accounting ledger and
 * granting charge access to a payment account have very different
 * consequences, and sharing one signing secret must not make the two
 * interchangeable.
 */
const MAX_AGE_MS = 10 * 60 * 1000; // long enough for a human to click through a consent screen

export type OAuthProvider = 'zoho' | 'stripe' | 'square';

interface StatePayload {
  readonly brandId: string;
  readonly provider: OAuthProvider;
  readonly iat: number;
}

export function signOAuthState(brandId: string, provider: OAuthProvider, secret: string): string {
  const payload: StatePayload = { brandId, provider, iat: Date.now() };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

/** Null on any failure — forged, expired, malformed, or minted for a different
 * provider all look identical to the caller, which is what refuses to leak
 * which case occurred. */
export function verifyOAuthState(
  state: string,
  provider: OAuthProvider,
  secret: string,
): { brandId: string } | null {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) return null;

  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as StatePayload;
  } catch {
    return null;
  }
  if (typeof payload.brandId !== 'string' || typeof payload.iat !== 'number') return null;
  if (payload.provider !== provider) return null;
  if (Date.now() - payload.iat > MAX_AGE_MS) return null;

  return { brandId: payload.brandId };
}
