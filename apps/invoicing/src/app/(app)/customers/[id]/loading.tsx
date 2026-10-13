import { PageSkeleton } from '@/components/page-skeleton';

/** More specific than the parent customers/loading.tsx list skeleton — a
 * detail page has far less to show while it loads. */
export default function CustomerDetailLoading() {
  return <PageSkeleton rows={3} />;
}
