import { PageContainer } from '@/components/page-container';

export const dynamic = 'force-dynamic';

/**
 * Sidebar destination for Notifications. Not built yet — see NotBuiltYet
 * in brand-settings/tabs.tsx for the same convention: a page that says what
 * it will do reads as unfinished, not broken.
 */
export default function NotificationsPage() {
  return (
    <PageContainer>
      <h1 className="text-2xl font-bold text-ink-strong">Notifications</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Alerts for invoice activity, payment failures, and sync issues across your brands.
      </p>

      <div className="mt-8 rounded-lg border border-dashed border-border bg-surface-muted p-8 text-center">
        <p className="text-sm font-medium text-ink-strong">Not built yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          A feed of account activity is planned but not built. Nothing here is muted or missed —
          there is simply nothing to show yet.
        </p>
      </div>
    </PageContainer>
  );
}
