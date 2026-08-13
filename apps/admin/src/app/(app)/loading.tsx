import { PageSkeleton } from '@/components/page-skeleton';

/** Shown while the dashboard's own data (customers, invoices, summary, Zoho
 * status) is still loading — see components/page-skeleton.tsx. */
export default function DashboardLoading() {
  return <PageSkeleton rows={5} />;
}
