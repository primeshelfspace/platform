'use client';

import Link from 'next/link';
import { useCan } from '@/hooks/use-permissions';

/**
 * What a page shows when the brand list comes back empty. For a role that
 * can create brands that genuinely means none exist yet; for a brand-scoped
 * role (Brand Admin, Finance, Sales, Read Only) it means nobody has assigned
 * them one — RLS only ever returns their own assignments — and a "create
 * your first brand" link would lead somewhere they cannot use.
 */
export function NoBrandsState({ createHref = '/brands/new' }: { createHref?: string }) {
  const canCreateBrand = useCan('BRANDS', 'WRITE');

  return (
    <div className="rounded-2xl border border-border bg-surface p-8 text-center">
      {canCreateBrand ? (
        <>
          <p className="text-sm text-ink-muted">No brands exist yet.</p>
          <Link
            href={createHref}
            className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
          >
            Create your first brand
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-ink-strong">
            You haven&rsquo;t been assigned to a brand yet.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Ask your account owner or admin to assign you a brand from Users &amp; Roles.
          </p>
        </>
      )}
    </div>
  );
}
