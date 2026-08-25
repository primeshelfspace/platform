import { type NextRequest, type NextResponse } from 'next/server';
import { startProviderConnect } from '@/lib/oauth-connect';

/** Begins the Zoho Books OAuth handshake. See lib/oauth-connect.ts for why
 * this cannot simply be a link straight at the API. */
export function GET(request: NextRequest): Promise<NextResponse> {
  return startProviderConnect(request, {
    provider: 'zoho',
    // The Zoho integration now lives on Brand Settings' Integrations tab
    // (IntegrationsPanel's new list/detail design), not the old standalone
    // /settings/integrations page — a failure here must land back on the
    // same screen the "Connect" button was clicked from.
    settingsPath: '/brand-settings',
    extraParams: { tab: 'integrations', integration: 'zoho' },
  });
}
