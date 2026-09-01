import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Retired standalone page. Brand Settings (/brand-settings) now owns both
 * Zoho ("Integrations") and Payment Gateways as its own tabs, in the same
 * shell (brand name, the full Brand Details/Branding/Integrations/Payment
 * Gateways tab bar) — this used to render a second, differently-styled page
 * with its own header and its own two-tab bar, which looked like leaving
 * Brand Settings entirely.
 *
 * Every existing link and OAuth callback aimed at this route (bookmarks, the
 * "Shop Payment Gateways" marketplace, the Payment Methods page) still
 * points here, so it forwards to the equivalent Brand Settings tab rather
 * than everyone having to be updated at once.
 */
export default async function LegacyIntegrationsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'tab' || value === undefined) continue;
    forwarded.set(key, value);
  }
  forwarded.set('tab', params.tab === 'payments' ? 'payments' : 'integrations');
  redirect(`/brand-settings?${forwarded}`);
}
