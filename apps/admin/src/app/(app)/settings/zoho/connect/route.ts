import { type NextRequest, type NextResponse } from 'next/server';
import { startProviderConnect } from '@/lib/oauth-connect';

/** Begins the Zoho Books OAuth handshake. See lib/oauth-connect.ts for why
 * this cannot simply be a link straight at the API. */
export function GET(request: NextRequest): Promise<NextResponse> {
  return startProviderConnect(request, {
    provider: 'zoho',
    settingsPath: '/settings/integrations',
  });
}
