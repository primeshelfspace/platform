import { redirect } from 'next/navigation';
import { can, type Role } from '@fenwick/shared';
import { PageContainer } from '@/components/page-container';
import { parsePageParams } from '@/lib/pagination';
import { ApiError, getCurrentUser, listBrands, listUsers, type Brand, type ManagedUser } from '@/lib/api';
import { UsersPageClient } from './users-page-client';

export const dynamic = 'force-dynamic';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    role?: string;
    status?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const params = await searchParams;
  const { page, pageSize } = parsePageParams(params);

  // Defense-in-depth only — the API guard is what actually stops an
  // unauthorized request. This just keeps someone without USERS READ from
  // seeing the page shell at all (see authorisation.ts: hiding navigation is
  // not access control, but it is still worth doing).
  const currentUser = await getCurrentUser();
  if (!can(currentUser.role as Role, 'USERS', 'READ')) {
    redirect('/');
  }
  const canWrite = can(currentUser.role as Role, 'USERS', 'WRITE');
  const canSuspend = can(currentUser.role as Role, 'USERS', 'DELETE');

  let brands: Brand[] = [];
  let brandsError: string | null = null;
  try {
    brands = await listBrands();
  } catch (cause) {
    brandsError = cause instanceof ApiError ? cause.message : String(cause);
  }

  let users: ManagedUser[] = [];
  let total = 0;
  let usersError: string | null = null;
  try {
    const result = await listUsers({
      search: params.search,
      role: params.role,
      status: params.status,
      page,
      pageSize,
    });
    users = result.data;
    total = result.total;
  } catch (cause) {
    usersError = cause instanceof ApiError ? cause.message : String(cause);
  }

  return (
    <PageContainer compact>
      <UsersPageClient
        currentUserId={currentUser.id}
        currentUserRole={currentUser.role}
        canWrite={canWrite}
        canSuspend={canSuspend}
        users={users}
        total={total}
        page={page}
        pageSize={pageSize}
        search={params.search ?? ''}
        role={params.role ?? ''}
        status={params.status ?? ''}
        brands={brands}
        brandsError={brandsError}
        usersError={usersError}
      />
    </PageContainer>
  );
}
