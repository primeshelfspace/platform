import { redirect } from 'next/navigation';
import { getCurrentUser, listBrands, listLocations } from '@/lib/api';
import { can } from '@/lib/permissions';
import {
  Badge,
  Card,
  PageHeader,
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/page-header';
import { createLocationAction, setLocationStatusAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Stores and warehouses. Owner/Admin see and manage all of them; anyone else
 * sees the locations of their brands plus any assigned to them (Team page).
 */
export default async function LocationsPage() {
  const user = await getCurrentUser();
  if (!can(user, 'LOCATIONS', 'READ')) redirect('/');
  const [locations, brands] = await Promise.all([listLocations(), listBrands()]);
  const brandName = new Map(brands.map((b) => [b.id, b.displayName]));
  const canWrite = can(user, 'LOCATIONS', 'WRITE');

  return (
    <>
      <PageHeader
        title="Locations"
        description="Stores and warehouses. A location can serve one brand or the whole company."
      />

      {canWrite && (
        <Card className="mb-6 p-6">
          <h2 className="mb-4 text-base font-bold text-[#0F172A]">Add a location</h2>
          <form
            action={createLocationAction}
            className="grid gap-3 sm:grid-cols-[1fr_160px_200px_auto]"
          >
            <input name="name" required maxLength={120} placeholder="Name" className={inputClass} />
            <select name="kind" className={inputClass} defaultValue="STORE">
              <option value="STORE">Store</option>
              <option value="WAREHOUSE">Warehouse</option>
            </select>
            <select name="brandId" className={inputClass} defaultValue="">
              <option value="">Whole company</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.displayName}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClass}>
              Add
            </button>
          </form>
        </Card>
      )}

      {locations.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No locations yet.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {locations.map((location) => {
              const active = location.status === 'ACTIVE';
              return (
                <li key={location.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#0F172A]">{location.name}</p>
                    <p className="text-sm text-slate-500">
                      {location.kind === 'STORE' ? 'Store' : 'Warehouse'} ·{' '}
                      {location.brandId
                        ? (brandName.get(location.brandId) ?? 'Brand')
                        : 'Whole company'}
                    </p>
                  </div>
                  <Badge tone={active ? 'green' : 'neutral'}>
                    {active ? 'Active' : 'Archived'}
                  </Badge>
                  {canWrite && (
                    <form action={setLocationStatusAction}>
                      <input type="hidden" name="id" value={location.id} />
                      <input type="hidden" name="status" value={active ? 'ARCHIVED' : 'ACTIVE'} />
                      <button type="submit" className={secondaryButtonClass}>
                        {active ? 'Archive' : 'Restore'}
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
