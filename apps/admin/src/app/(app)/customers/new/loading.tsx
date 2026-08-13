import { PageSkeleton } from '@/components/page-skeleton';

/** More specific than the parent customers/loading.tsx list skeleton — this
 * is a form, not a list. */
export default function NewCustomerLoading() {
  return <PageSkeleton rows={3} />;
}
