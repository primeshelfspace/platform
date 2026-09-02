import Link from 'next/link';

export const BRAND_SETTINGS_TABS = [
  { key: 'details', label: 'Brand Details' },
  { key: 'branding', label: 'Branding' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'payments', label: 'Payment Gateways' },
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
 * Top-level sections of Brand Settings — Brand Details, Branding,
 * Integrations and Payment Gateways all render in this page (a query-param
 * tab, same convention as everywhere else brand-scoped pages in this app
 * carry state — shareable, bookmarkable, survives a refresh), so the tab bar
 * and the "DynoJerky / Brand Settings" header stay on screen no matter which
 * one is open. Payment Gateways used to be a plain link out to a standalone
 * page with its own separate header/tabs — folded in here instead so
 * connecting a gateway doesn't visually leave Brand Settings.
 */
export function BrandSettingsTabs({
  active,
  brandId,
}: {
  active: BrandSettingsTab;
  brandId: string | undefined;
}) {
  const tabClass = (selected: boolean) =>
    `block whitespace-nowrap border-b-2 px-1 pb-2 text-sm transition-colors ${
      selected
        ? 'border-ink-strong font-semibold text-ink-strong'
        : 'border-transparent text-ink-muted hover:border-border hover:text-ink-strong'
    }`;

  return (
    <nav
      className="sticky top-0 z-10 mt-3 border-b border-border bg-canvas"
      aria-label="Brand settings sections"
    >
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
      </ul>
    </nav>
  );
}

/**
 * Second-level tabs shown only within the Branding section. Rendered at the
 * top of the two-column editor's Preview (right-hand) section, on the same
 * row as "Brand Elements" in the left column.
 *
 * Width-matched to the Preview heading and card beneath it, not the full
 * section — all three editors pass `mx-auto max-w-[640px]` so the tab row
 * lines up with the 640px preview it controls, instead of spanning the
 * wider column around it.
 */
export function BrandingSubTabs({
  active,
  brandId,
  className = '',
}: {
  active: BrandingSubTab;
  brandId: string | undefined;
  className?: string;
}) {
  return (
    <nav className={`border-b border-[#E5E5E5] ${className}`} aria-label="Branding sections">
      <ul className="-mb-px flex gap-[22px] overflow-x-auto">
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
