import { type NextRequest, type NextResponse } from 'next/server';
import { startProviderConnect } from '@/lib/oauth-connect';

/**
 * Begins the Square Connect handshake. The Square panel lives on the
 * Payment Gateways tab of /brand-settings, same as Stripe's.
 */
export function GET(request: NextRequest): Promise<NextResponse> {
  return startProviderConnect(request, {
    provider: 'square',
    settingsPath: '/brand-settings',
    errorParam: 'squareError',
    extraParams: { tab: 'payments' },
  });
}
