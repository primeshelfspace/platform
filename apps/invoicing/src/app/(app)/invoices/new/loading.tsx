import { PageSkeleton } from '@/components/page-skeleton';

/** More specific than the parent invoices/loading.tsx list skeleton — this
 * is a form, not a list. */
export default function NewInvoiceLoading() {
  return <PageSkeleton rows={3} />;
}
