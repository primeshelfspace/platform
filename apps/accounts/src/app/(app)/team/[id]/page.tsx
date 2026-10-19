import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { HQ_ROLES, PRODUCT_NAMES, coversAllBrands } from '@platform/platform-contracts';
import {
  ApiError,
  getCurrentUser,
  getUser,
  listBrands,
  listLocations,
  type ManagedUser,
} from '@/lib/api';
import { can } from '@/lib/permissions';
import { Notice, roleLabel } from '@/components/notice';
import {
  Badge,
  Card,
  PageHeader,
  inputClass,
  secondaryButtonClass,
} from '@/components/page-header';
import { brandsAction, locationsAction, productRoleAction, statusAction } from '../actions';

export const dynamic = 'force-dynamic';

/** One person: their role in each product, their brands, and their locations. */
export default async function TeamMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [{ id }, notice, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  if (!can(user, 'USERS', 'READ')) redirect('/');

  let member: ManagedUser;
  try {
    member = await getUser(id);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
  const [brands, locations] = await Promise.all([listBrands(), listLocations()]);

  const isSelf = member.id === user.id;
  const editable = can(user, 'USERS', 'WRITE') && !isSelf;
  const allBrands = coversAllBrands(member.role);

  return (
    <>
      <Link
        href="/team"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#0F172A]"
      >
        <ArrowLeft className="h-4 w-4" /> Team
      </Link>
      <PageHeader title={member.name} description={member.email} />
      <Notice saved={notice.saved} error={notice.error} />
      {isSelf && <p className="mb-6 text-sm text-slate-500">You can’t change your own access.</p>}

      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="mb-4 text-base font-bold text-[#0F172A]">Products</h2>
          <div className="space-y-4">
            <ProductRoleRow
              member={member}
              product="INVOICING"
              roles={user.assignableRoles}
              allowNone={false}
              editable={editable}
            />
            <ProductRoleRow
              member={member}
              product="HQ"
              roles={HQ_ROLES}
              allowNone
              editable={editable && user.allBrands}
            />
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-1 text-base font-bold text-[#0F172A]">Brands</h2>
          {allBrands ? (
            <p className="text-sm text-slate-500">This role covers every brand.</p>
          ) : (
            <form action={brandsAction} className="mt-3 space-y-4">
              <input type="hidden" name="id" value={member.id} />
              <div className="flex flex-wrap gap-4">
                {brands.map((brand) => (
                  <label key={brand.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="brandIds"
                      value={brand.id}
                      defaultChecked={member.assignedBrandIds.includes(brand.id)}
                      disabled={!editable}
                    />
                    {brand.displayName}
                  </label>
                ))}
              </div>
              {editable && (
                <button type="submit" className={secondaryButtonClass}>
                  Save brands
                </button>
              )}
            </form>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="mb-1 text-base font-bold text-[#0F172A]">Locations</h2>
          {allBrands ? (
            <p className="text-sm text-slate-500">This role covers every location.</p>
          ) : (
            <form action={locationsAction} className="mt-3 space-y-4">
              <input type="hidden" name="id" value={member.id} />
              <p className="text-sm text-slate-500">
                They already see the locations of their brands. Add others here.
              </p>
              {locations.length === 0 ? (
                <p className="text-sm text-slate-500">No locations you can assign.</p>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {locations.map((location) => (
                    <label
                      key={location.id}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        name="locationIds"
                        value={location.id}
                        defaultChecked={member.assignedLocationIds.includes(location.id)}
                        disabled={!editable}
                      />
                      {location.name}
                    </label>
                  ))}
                </div>
              )}
              {editable && locations.length > 0 && (
                <button type="submit" className={secondaryButtonClass}>
                  Save locations
                </button>
              )}
            </form>
          )}
        </Card>

        <Card className="flex flex-wrap items-center gap-4 p-6">
          <div className="flex-1">
            <h2 className="text-base font-bold text-[#0F172A]">Account</h2>
            <p className="text-sm text-slate-500">Suspending signs them out of every product.</p>
          </div>
          <Badge
            tone={
              member.status === 'ACTIVE' ? 'green' : member.status === 'INVITED' ? 'amber' : 'red'
            }
          >
            {roleLabel(member.status)}
          </Badge>
          {can(user, 'USERS', 'DELETE') && !isSelf && (
            <form action={statusAction}>
              <input type="hidden" name="id" value={member.id} />
              <input
                type="hidden"
                name="status"
                value={member.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED'}
              />
              <button type="submit" className={secondaryButtonClass}>
                {member.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
              </button>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}

function ProductRoleRow({
  member,
  product,
  roles,
  allowNone,
  editable,
}: {
  member: ManagedUser;
  product: 'INVOICING' | 'HQ';
  roles: readonly string[];
  allowNone: boolean;
  editable: boolean;
}) {
  const current = member.productRoles[product] ?? '';
  return (
    <form action={productRoleAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={member.id} />
      <input type="hidden" name="product" value={product} />
      <span className="w-28 text-sm font-semibold text-[#0F172A]">{PRODUCT_NAMES[product]}</span>
      {editable ? (
        <>
          <select name="role" defaultValue={current} className={`${inputClass} max-w-xs`}>
            {allowNone && <option value="">No access</option>}
            {!roles.includes(current) && current && (
              <option value={current}>{roleLabel(current)}</option>
            )}
            {roles.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
          <button type="submit" className={secondaryButtonClass}>
            Save
          </button>
        </>
      ) : (
        <span className="text-sm text-slate-600">{current ? roleLabel(current) : 'No access'}</span>
      )}
    </form>
  );
}
