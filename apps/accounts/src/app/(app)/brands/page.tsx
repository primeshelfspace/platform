import { redirect } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { getCurrentUser, listBrands, listLocations } from '@/lib/api';
import { can } from '@/lib/permissions';
import { productInfo } from '@/lib/products';
import { Badge, Card, PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

/**
 * The company's brands — shared by every product. Each user sees the brands
 * they can reach (all of them for Owner/Admin). Adding a brand also sets up
 * its invoicing (invoice numbering), so for now that happens in Sugrpay.
 */
export default async function BrandsPage() {
  const user = await getCurrentUser();
  if (!can(user, 'BRANDS', 'READ')) redirect('/');
  const [brands, locations] = await Promise.all([listBrands(), listLocations().catch(() => [])]);
  const invoicing = productInfo('INVOICING');
  const canAdd =
    can(user, 'BRANDS', 'WRITE') &&
    Boolean(invoicing.url) &&
    user.products.some((p) => p.product === 'INVOICING');

  return (
    <>
      <PageHeader
        title="Brands"
        description="The brands your company trades under. Every product uses the same list."
        actions={
          canAdd ? (
            <a
              href={`${invoicing.url}/brands/new`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800"
            >
              Add a brand in {invoicing.name}
              <ArrowUpRight className="h-4 w-4" />
            </a>
          ) : undefined
        }
      />
      {brands.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No brands yet.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {brands.map((brand) => {
              const count = locations.filter((l) => l.brandId === brand.id).length;
              return (
                <li key={brand.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                  <span
                    className="h-8 w-8 shrink-0 rounded-lg"
                    style={{ backgroundColor: brand.themeColor }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#0F172A]">{brand.displayName}</p>
                    <p className="truncate text-sm text-slate-500">
                      {brand.legalName} · {brand.currency} · {brand.timezone}
                    </p>
                  </div>
                  <span className="text-sm text-slate-500">
                    {count} location{count === 1 ? '' : 's'}
                  </span>
                  <Badge tone={brand.status === 'ACTIVE' ? 'green' : 'neutral'}>
                    {brand.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
