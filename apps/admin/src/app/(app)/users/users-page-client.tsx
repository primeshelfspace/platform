'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { toast } from '@fenwick/ui/toast';
import { Pagination } from '@fenwick/ui/pagination';
import { ROLES } from '@fenwick/shared';
import { Select } from '@/components/ui/select';
import type { Brand, ManagedUser } from '@/lib/api';
import { InviteUserModal } from './invite-user-modal';
import { AssignBrandsModal } from './assign-brands-modal';
import { UserRow } from './user-row';
import { RolesMatrix } from './roles-matrix';
import { ROLE_LABELS } from './role-labels';

const SEARCH_DEBOUNCE_MS = 300;

export function UsersPageClient({
  currentUserId,
  currentUserRole,
  canWrite,
  canSuspend,
  users,
  total,
  page,
  pageSize,
  search,
  role,
  status,
  brands,
  brandsError,
  usersError,
}: {
  currentUserId: string;
  currentUserRole: string;
  canWrite: boolean;
  canSuspend: boolean;
  users: ManagedUser[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  role: string;
  status: string;
  brands: Brand[];
  brandsError: string | null;
  usersError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchTerm, setSearchTerm] = useState(search);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [brandsTarget, setBrandsTarget] = useState<ManagedUser | null>(null);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setSearchTerm(search), [search]);

  const brandNameById = new Map(brands.map((b) => [b.id, b.displayName]));

  function pushParams(next: Record<string, string | null>) {
    const query = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') query.delete(key);
      else query.set(key, value);
    }
    router.push(`${pathname}?${query.toString()}`);
  }

  function onSearchChange(value: string) {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => pushParams({ search: value || null, page: null }),
      SEARCH_DEBOUNCE_MS,
    );
  }

  function onPageChange(nextPage: number) {
    pushParams({ page: nextPage === 1 ? null : String(nextPage) });
  }

  function onPageSizeChange(nextPageSize: number) {
    pushParams({ pageSize: String(nextPageSize), page: null });
  }

  function onInvited(user: ManagedUser) {
    setInviteOpen(false);
    toast.success(`Invitation sent to ${user.email}.`);
    router.refresh();
  }

  function onChanged(_user: ManagedUser) {
    router.refresh();
  }

  function onBrandsUpdated(_user: ManagedUser) {
    setBrandsTarget(null);
    router.refresh();
  }

  return (
    <div>
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-[#0F172A]">Users &amp; Roles</h1>
          <p className="mt-1 text-[15px] text-[#64748B]">
            Invite teammates, assign roles and brands, and control who can sign in.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-black px-4 text-sm font-bold
                       text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Invite User
          </button>
        )}
      </header>

      {brandsError && (
        <div className="mb-4 rounded-md bg-danger-surface p-4 text-sm text-danger">
          Could not load brands: {brandsError}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-[#737373]"
            aria-hidden
          />
          <input
            type="search"
            aria-label="Search users by name or email"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search"
            className="h-8 w-full appearance-none rounded-lg bg-[#E7EDF5] pl-9 pr-3 text-sm text-[#0F172A]
                       placeholder:text-[#737373] focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-slate-900 focus-visible:ring-offset-1"
          />
        </div>

        <div className="w-40">
          <Select
            name="role-filter"
            compact
            value={role}
            onChange={(value) => pushParams({ role: value || null, page: null })}
            placeholder="All roles"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-36">
          <Select
            name="status-filter"
            compact
            value={status}
            onChange={(value) => pushParams({ status: value || null, page: null })}
            placeholder="All statuses"
          >
            <option value="INVITED">Invited</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
        </div>
      </div>

      {usersError ? (
        <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
          <p className="font-medium">Could not load users.</p>
          <p className="mt-1 font-mono text-xs">{usersError}</p>
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-ink-muted">No users match these filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#E5E7EB]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-surface-muted text-left">
                  <th className="px-4 py-2.5 font-semibold text-ink-strong">User</th>
                  <th className="px-4 py-2.5 font-semibold text-ink-strong">Role</th>
                  <th className="px-4 py-2.5 font-semibold text-ink-strong">Brands</th>
                  <th className="px-4 py-2.5 font-semibold text-ink-strong">Status</th>
                  <th className="px-4 py-2.5 font-semibold text-ink-strong">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    currentUserId={currentUserId}
                    currentUserRole={currentUserRole}
                    canWrite={canWrite}
                    canSuspend={canSuspend}
                    brandNameById={brandNameById}
                    onChanged={onChanged}
                    onAssignBrands={setBrandsTarget}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            itemLabel="users"
          />
        </div>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setMatrixOpen((open) => !open)}
          className="flex items-center gap-1.5 text-sm font-medium text-ink-strong"
          aria-expanded={matrixOpen}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${matrixOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
          Roles &amp; permissions reference
        </button>
        {matrixOpen && (
          <div className="mt-3">
            <RolesMatrix />
          </div>
        )}
      </div>

      <InviteUserModal
        open={inviteOpen}
        brands={brands}
        actorRole={currentUserRole}
        onClose={() => setInviteOpen(false)}
        onInvited={onInvited}
      />
      <AssignBrandsModal
        user={brandsTarget}
        brands={brands}
        onClose={() => setBrandsTarget(null)}
        onUpdated={onBrandsUpdated}
      />
    </div>
  );
}
