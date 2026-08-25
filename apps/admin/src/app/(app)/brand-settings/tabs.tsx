import Link from 'next/link';

export const BRAND_SETTINGS_TABS = [
  { key: 'details', label: 'Brand Details' },
  { key: 'branding', label: 'Branding' },
  { key: 'integrations', label: 'Integrations' },
] as const;

export type BrandSettingsTab = (typeof BRAND_SETTINGS_TABS)[number]['key'];

export function isBrandSettingsTab(value: string | undefined): value is BrandSettingsTab {
  return BRAND_SETTINGS_TABS.some((t) => t.key === value);
}

export const BRANDING_SUB_TABS = [
  { key: 'email-receipt', label: 'Email Receipt' },
  { key: 'invoice-pdf', label: 'Invoice PDF' },
  { key: 'payment-page', label: 'Payment Page' },
] as const;

export type BrandingSubTab = (typeof BRANDING_SUB_TABS)[number]['key'];

export function isBrandingSubTab(value: string | undefined): value is BrandingSubTab {
  return BRANDING_SUB_TABS.some((t) => t.key === value);
}

function tabHref(brandId: string | undefined, query: Record<string, string>): string {
  const params = new URLSearchParams(query);
  if (brandId) params.set('brandId', brandId);
  return `/brand-settings?${params}`;
}

/**
 * Top-level sections of Brand Settings. Brand Details, Branding and
 * Integrations render in this page (a query-param tab, same convention as
 * everywhere else brand-scoped pages in this app carry state — shareable,
 * bookmarkable, survives a refresh). Payment Gateways already has a real
 * standalone page elsewhere in the app (Settings → Integrations' "Payment
 * Gateways" tab, the connect/disconnect flow for Stripe, PayPal, Square and
 * Authorize.net) — rather than duplicate it, this one is a plain link out to
 * that page so there is exactly one place it lives.
 */
export function BrandSettingsTabs({
  active,
  brandId,
}: {
  active: BrandSettingsTab;
  brandId: string | undefined;
}) {
  const linkOutTabs = [
    {
      href: `/settings/integrations?tab=payments${brandId ? `&brandId=${brandId}` : ''}`,
      label: 'Payment Gateways',
    },
  ];

  const tabClass = (selected: boolean) =>
    `block whitespace-nowrap border-b-2 px-1 pb-2 text-sm transition-colors ${
      selected
        ? 'border-ink-strong font-semibold text-ink-strong'
        : 'border-transparent text-ink-muted hover:border-border hover:text-ink-strong'
    }`;

  return (
    <nav className="mt-3 border-b border-border" aria-label="Brand settings sections">
      <ul className="-mb-px flex gap-6 overflow-x-auto">
        {BRAND_SETTINGS_TABS.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tabHref(brandId, { tab: tab.key })}
              aria-current={tab.key === active ? 'page' : undefined}
              className={tabClass(tab.key === active)}
            >
              {tab.label}
            </Link>
          </li>
        ))}
        {linkOutTabs.map((tab) => (
          <li key={tab.label}>
            <Link href={tab.href} className={tabClass(false)}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Second-level tabs shown only within the Branding section. */
export function BrandingSubTabs({
  active,
  brandId,
}: {
  active: BrandingSubTab;
  brandId: string | undefined;
}) {
  return (
    <nav className="mt-3 border-b border-border" aria-label="Branding sections">
      <ul className="-mb-px flex gap-6 overflow-x-auto">
        {BRANDING_SUB_TABS.map((tab) => {
          const selected = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tabHref(brandId, { tab: 'branding', sub: tab.key })}
                aria-current={selected ? 'page' : undefined}
                className={`block whitespace-nowrap border-b-2 px-1 pb-2 text-sm transition-colors ${
                  selected
                    ? 'border-ink-strong font-semibold text-ink-strong'
                    : 'border-transparent text-ink-muted hover:border-border hover:text-ink-strong'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
