import { redirect } from 'next/navigation';
import { getCurrentUser, listSubscriptions } from '@/lib/api';
import { can } from '@/lib/permissions';
import { productInfo } from '@/lib/products';
import { Badge, Card, PageHeader, secondaryButtonClass } from '@/components/page-header';
import { setSubscriptionAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Which products the company has. Billing is not connected to a payment
 * provider yet, so this is a manual switch — turning a product off blocks
 * every request to it on the very next call.
 */
export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!can(user, 'PLAN_AND_BILLING', 'READ')) redirect('/');
  const subscriptions = await listSubscriptions();
  const canWrite = can(user, 'PLAN_AND_BILLING', 'WRITE');

  return (
    <>
      <PageHeader
        title="Billing"
        description="Turn products on or off for your company. Payment details are not connected yet."
      />
      <Card>
        <ul className="divide-y divide-slate-100">
          {subscriptions.map((sub) => {
            const info = productInfo(sub.product);
            const active = sub.status === 'ACTIVE';
            return (
              <li key={sub.product} className="flex flex-wrap items-center gap-4 px-6 py-5">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[#0F172A]">{info.name}</p>
                  <p className="text-sm text-slate-500">{info.description}</p>
                  {active && sub.startedAt && (
                    <p className="mt-1 text-xs text-slate-400">
                      Plan: {sub.plan} · since {new Date(sub.startedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <Badge tone={active ? 'green' : sub.status === 'CANCELLED' ? 'amber' : 'neutral'}>
                  {active ? 'Active' : sub.status === 'CANCELLED' ? 'Cancelled' : 'Not subscribed'}
                </Badge>
                {canWrite && (
                  <form action={setSubscriptionAction}>
                    <input type="hidden" name="product" value={sub.product} />
                    <input type="hidden" name="status" value={active ? 'CANCELLED' : 'ACTIVE'} />
                    <button type="submit" className={secondaryButtonClass}>
                      {active ? 'Turn off' : 'Turn on'}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
