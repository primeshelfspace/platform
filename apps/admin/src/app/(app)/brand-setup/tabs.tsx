import Link from 'next/link';

export const BRAND_SETUP_TABS = [
  { key: 'details', label: 'Brand Details' },
  { key: 'invoice-pdf', label: 'Invoice PDF' },
  { key: 'email-template', label: 'Email Template' },
  { key: 'payment-page', label: 'Payment Page' },
] as const;

export type BrandSetupTab = (typeof BRAND_SETUP_TABS)[number]['key'];

export function isBrandSetupTab(value: string | undefined): value is BrandSetupTab {
  return BRAND_SETUP_TABS.some((t) => t.key === value);
}

/**
 * Links rather than client-side state, so a tab is a real URL: shareable,
 * bookmarkable, and survivable across a refresh. The brand id rides along
 * because every page in this app is scoped by it.
 */
export function BrandSetupTabs({
  active,
  brandId,
}: {
  active: BrandSetupTab;
  brandId: string | undefined;
}) {
  return (
    <nav className="mt-6 border-b border-border" aria-label="Brand setup sections">
      <ul className="-mb-px flex gap-6 overflow-x-auto">
        {BRAND_SETUP_TABS.map((tab) => {
          const selected = tab.key === active;
          const query = new URLSearchParams({ tab: tab.key });
          if (brandId) query.set('brandId', brandId);

          return (
            <li key={tab.key}>
              <Link
                href={`/brand-setup?${query}`}
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
 * Shown for the three sections that are designed but not built.
 *
 * Deliberately explicit rather than a spinner or an empty panel: a tab that
 * looks broken generates a bug report, while one that says what it will do
 * does not. Each names the setting it will own, so the gap is legible.
 */
export function NotBuiltYet({ tab }: { tab: Exclude<BrandSetupTab, 'details'> }) {
  const copy: Record<Exclude<BrandSetupTab, 'details'>, string> = {
    'invoice-pdf':
      'Layout, logo placement and footer text for the PDF your customers receive. Invoices currently render with the platform default.',
    'email-template':
      'Subject lines and body copy for invoice, reminder and receipt emails, per brand.',
    'payment-page':
      'Wording and options on the hosted payment page. Which methods it offers is already configurable under Payment Methods.',
  };

  return (
    <div className="mt-8 rounded-lg border border-dashed border-border bg-surface-muted p-8 text-center">
      <p className="text-sm font-medium text-ink-strong">Not built yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{copy[tab]}</p>
    </div>
  );
}
