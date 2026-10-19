import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { PRODUCTS } from '@platform/platform-contracts';
import { getCurrentUser } from '@/lib/api';
import { can } from '@/lib/permissions';
import { productInfo } from '@/lib/products';
import { Badge, Card, PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

/**
 * The product switcher: every product, and whether this user can open it.
 * A product opens when the company subscribes to it and the user holds a role
 * in it — the same two checks the API makes on every product request.
 */
export default async function ProductsPage() {
  const user = await getCurrentUser();
  const mine = new Map(user.products.map((p) => [p.product, p]));
  const canManageBilling = can(user, 'PLAN_AND_BILLING', 'WRITE');

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name.split(' ')[0] ?? user.name}`}
        description="Choose a product to open. One sign-in works for all of them."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {PRODUCTS.map((product) => {
          const info = productInfo(product);
          const access = mine.get(product);
          const openable = Boolean(access && info.url);
          return (
            <Card key={product} className="flex flex-col p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-extrabold text-[#0F172A]">{info.name}</h2>
                {access ? (
                  <Badge tone="green">{humanise(access.role)}</Badge>
                ) : (
                  <Badge>No access</Badge>
                )}
              </div>
              <p className="mt-2 flex-1 text-sm text-slate-500">{info.description}</p>
              <div className="mt-6">
                {openable ? (
                  <a
                    href={info.url}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800"
                  >
                    Open {info.name}
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                ) : access && !info.url ? (
                  <p className="text-sm text-slate-500">Coming soon.</p>
                ) : canManageBilling ? (
                  <Link href="/billing" className="text-sm font-semibold text-[#0F172A] underline">
                    Manage in Billing
                  </Link>
                ) : (
                  <p className="text-sm text-slate-500">Ask your account owner for access.</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function humanise(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
