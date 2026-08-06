import { type NextRequest, type NextResponse } from 'next/server';
import { startProviderConnect } from '@/lib/oauth-connect';

/**
 * Begins the Stripe Connect handshake. The Stripe panel lives on the
 * payment-methods screen, so that is where a failure returns to.
 */
export function GET(request: NextRequest): Promise<NextResponse> {
  return startProviderConnect(request, {
    provider: 'stripe',
    settingsPath: '/settings/payment-methods',
    errorParam: 'stripeError',
  });
}
