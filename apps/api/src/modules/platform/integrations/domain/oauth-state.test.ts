import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signOAuthState, verifyOAuthState } from './oauth-state.js';

const SECRET = 'a-test-secret-that-is-long-enough-1234567890';
const BRAND_ID = '11111111-1111-1111-1111-111111111111';

describe('OAuth state', () => {
  it('round-trips the brand id through sign and verify', () => {
    const state = signOAuthState(BRAND_ID, 'zoho', SECRET);
    expect(verifyOAuthState(state, 'zoho', SECRET)).toEqual({ brandId: BRAND_ID });
  });

  it('rejects a state signed with a different secret', () => {
    const state = signOAuthState(BRAND_ID, 'zoho', SECRET);
    expect(verifyOAuthState(state, 'zoho', 'a-completely-different-secret-value')).toBeNull();
  });

  it('rejects a tampered payload even with a structurally valid signature format', () => {
    const state = signOAuthState(BRAND_ID, 'zoho', SECRET);
    const [, signature] = state.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        brandId: '22222222-2222-2222-2222-222222222222',
        provider: 'zoho',
        iat: Date.now(),
      }),
      'utf8',
    ).toString('base64url');
    expect(verifyOAuthState(`${forgedPayload}.${signature}`, 'zoho', SECRET)).toBeNull();
  });

  it('rejects a malformed state string instead of throwing', () => {
    expect(verifyOAuthState('not-a-valid-state', 'zoho', SECRET)).toBeNull();
    expect(verifyOAuthState('', 'zoho', SECRET)).toBeNull();
  });

  it('rejects a state older than the allowed window', () => {
    // Construct one directly with a backdated iat, bypassing signOAuthState's
    // use of Date.now().
    const stalePayload = { brandId: BRAND_ID, provider: 'zoho', iat: Date.now() - 11 * 60 * 1000 };
    const encoded = Buffer.from(JSON.stringify(stalePayload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', SECRET).update(encoded).digest('base64url');
    expect(verifyOAuthState(`${encoded}.${signature}`, 'zoho', SECRET)).toBeNull();
  });

  it("refuses a state minted for another provider's consent screen", () => {
    // Same secret, same brand, valid signature, in-window — rejected purely
    // because granting Stripe charge access must not be replayable as a Zoho
    // ledger connection, or the reverse.
    const stripeState = signOAuthState(BRAND_ID, 'stripe', SECRET);
    expect(verifyOAuthState(stripeState, 'zoho', SECRET)).toBeNull();
    expect(verifyOAuthState(stripeState, 'stripe', SECRET)).toEqual({ brandId: BRAND_ID });
  });
});
