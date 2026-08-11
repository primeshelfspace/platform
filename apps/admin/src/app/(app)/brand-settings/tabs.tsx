import Link from 'next/link';

export const BRAND_SETTINGS_TABS = [
  { key: 'details', label: 'Brand Details' },
  { key: 'branding', label: 'Branding' },
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
 * Top-level sections of Brand Settings. Brand Details and Branding render in
 * this page (a query-param tab, same convention as everywhere else brand-
 * scoped pages in this app carry state — shareable, bookmarkable, survives a
 * refresh). Integrations and Payment Gateways already have real standalone
 * pages elsewhere in the app; rather than duplicate them, these two are
 * plain links out to those pages so there is exactly one place each setting
 * lives.
 */
export function BrandSettingsTabs({
  active,
  brandId,
}: {
  active: BrandSettingsTab;
  brandId: string | undefined;
}) {
  function hrefFor(path: string): string {
    return brandId ? `${path}?brandId=${brandId}` : path;
  }

  const linkOutTabs = [
    { href: hrefFor('/settings/integrations'), label: 'Integrations' },
    { href: hrefFor('/settings/payment-methods'), label: 'Payment Gateways' },
  ];

  const tabClass = (selected: boolean) =>
    `block whitespace-nowrap border-b-2 px-1 pb-3 text-sm transition-colors ${
      selected
        ? 'border-ink-strong font-semibold text-ink-strong'
        : 'border-transparent text-ink-muted hover:border-border hover:text-ink-strong'
    }`;

  return (
    <nav className="mt-6 border-b border-border" aria-label="Brand settings sections">
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
    <nav className="mt-6 border-b border-border" aria-label="Branding sections">
      <ul className="-mb-px flex gap-6 overflow-x-auto">
        {BRANDING_SUB_TABS.map((tab) => {
          const selected = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tabHref(brandId, { tab: 'branding', sub: tab.key })}
                aria-current={selected ? 'page' : undefined}
                className={`block whitespace-nowrap border-b-2 px-1 pb-3 text-sm transition-colors ${
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

/**
 * Shown for Branding sub-sections that are designed but not built.
 *
 * Deliberately explicit rather than a spinner or an empty panel: a tab that
 * looks broken generates a bug report, while one that says what it will do
 * does not. Each names the setting it will own, so the gap is legible.
 */
export function NotBuiltYet({ tab }: { tab: Exclude<BrandingSubTab, 'payment-page'> }) {
  const copy: Record<Exclude<BrandingSubTab, 'payment-page'>, string> = {
    'invoice-pdf':
      'Layout, logo placement and footer text for the PDF your customers receive. Invoices currently render with the platform default.',
    'email-receipt':
      'Subject lines and body copy for invoice, reminder and receipt emails, per brand.',
  };

  return (
    <div className="mt-8 rounded-lg border border-dashed border-border bg-surface-muted p-8 text-center">
      <p className="text-sm font-medium text-ink-strong">Not built yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{copy[tab]}</p>
    </div>
  );
}
