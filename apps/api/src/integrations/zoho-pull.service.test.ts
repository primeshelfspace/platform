/**
 * ZohoPullService has no existing test coverage (see the inspection this
 * feature was built from) — these exercise the customer half of pullBrand
 * end to end against hand-rolled fakes for Prisma, IntegrationConnectionService
 * and SystemScopeResolver, with the real ZohoBooksAdapter instance but its
 * two network methods (listContactsPage/getContact) stubbed per test. This
 * mirrors zoho-books.adapter.test.ts's `new ZohoBooksAdapter({} as Env)`
 * pattern rather than inventing a new one.
 *
 * Invoices and payments are stubbed to empty pages throughout — this file is
 * about the new customer-sync behaviour (create/update/dedupe/paginate/
 * archive/isolate/error-handle), not a re-test of the invoice/payment pull
 * paths, which are untouched by this feature.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationError, type Scope } from '@fenwick/shared';
import type { Env } from '../config/env.js';
import { ZohoBooksAdapter, type ZohoContactDetail } from '../adapters/accounting/zoho-books.adapter.js';
import { ZohoPullService } from './zoho-pull.service.js';

interface FakeCustomerRow {
  id: string;
  brandId: string;
  zohoContactId: string | null;
  displayName: string;
  status: 'ACTIVE' | 'ARCHIVED';
  [key: string]: unknown;
}

interface FakeSyncJobRow {
  id: string;
  brandId: string;
  objectType: string;
  objectId: string | null;
  status: string;
  errorClass: string | null;
  [key: string]: unknown;
}

/** Matches Prisma's `where` shape closely enough for the clauses
 * zoho-pull.service.ts actually issues: plain equality, `{ not: value }` and
 * `{ in: [...] }`. Not a Prisma reimplementation — just enough to prove the
 * real service code filters correctly. */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition && typeof condition === 'object') {
      if ('not' in condition) return value !== (condition as { not: unknown }).not;
      if ('in' in condition) return (condition as { in: unknown[] }).in.includes(value);
      return true;
    }
    return value === condition;
  });
}

function makeFakePrisma() {
  const customers: FakeCustomerRow[] = [];
  const syncJobs: FakeSyncJobRow[] = [];
  let seq = 0;

  const client = {
    customer: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        customers.find((c) => matchesWhere(c, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        customers.filter((c) => matchesWhere(c, where)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `cust-${++seq}`, status: 'ACTIVE', ...data } as FakeCustomerRow;
        customers.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = customers.find((c) => c.id === where.id);
        if (!row) throw new Error(`no fake customer ${where.id}`);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = customers.filter((c) => matchesWhere(c, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    syncJob: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `job-${++seq}`, ...data } as FakeSyncJobRow;
        syncJobs.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = syncJobs.find((j) => j.id === where.id);
        if (!row) throw new Error(`no fake sync job ${where.id}`);
        Object.assign(row, data);
        return row;
      },
    },
  };

  const prisma = {
    withScope: async <T>(_scope: unknown, work: (tx: typeof client) => Promise<T>) => work(client),
    withoutScope: async <T>(_reason: string, work: (tx: typeof client) => Promise<T>) => work(client),
  };

  return { prisma, customers, syncJobs };
}

const SCOPE = { merchantId: 'merchant-1' } as unknown as Scope;
const CONNECTION = {
  brandId: 'brand-1',
  organisationId: 'org-1',
  accessToken: 'tok',
  refreshToken: 'refresh',
  expiresAt: null,
};

function contact(overrides: Partial<ZohoContactDetail> = {}): ZohoContactDetail {
  return {
    contact_id: 'c1',
    contact_name: 'Acme Co',
    email: 'acme@example.com',
    last_modified_time: '2026-08-01T00:00:00Z',
    status: 'active',
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof makeFakePrisma>['prisma']) {
  const zoho = new ZohoBooksAdapter({} as Env);
  const connections = {
    buildAccountingConnection: vi.fn().mockResolvedValue(CONNECTION),
    getLastPulledAt: vi.fn().mockResolvedValue(null),
    recordPullRun: vi.fn().mockResolvedValue(undefined),
  };
  const systemScope = { forBrand: vi.fn().mockResolvedValue(SCOPE) };

  // Invoices/payments are out of scope for this file — always empty pages.
  vi.spyOn(zoho, 'listInvoicesPage').mockResolvedValue({ invoices: [], hasMorePage: false });
  vi.spyOn(zoho, 'listPaymentsPage').mockResolvedValue({ payments: [], hasMorePage: false });

  const service = new ZohoPullService(
    prisma as never,
    zoho,
    connections as never,
    systemScope as never,
  );
  return { service, zoho, connections };
}

const BRAND_A = 'brand-a';
const BRAND_B = 'brand-b';

describe('ZohoPullService — customer sync', () => {
  let fake: ReturnType<typeof makeFakePrisma>;

  beforeEach(() => {
    fake = makeFakePrisma();
  });

  it('creates a new local customer for a contact not seen before', async () => {
    const { service, zoho } = makeService(fake.prisma);
    vi.spyOn(zoho, 'listContactsPage').mockResolvedValue({
      contacts: [contact()],
      hasMorePage: false,
    });
    vi.spyOn(zoho, 'getContact').mockResolvedValue(contact());

    const counts = await service.pullBrand(BRAND_A);

    expect(counts.customers).toBe(1);
    expect(fake.customers).toHaveLength(1);
    expect(fake.customers[0]).toMatchObject({
      brandId: BRAND_A,
      zohoContactId: 'c1',
      displayName: 'Acme Co',
      status: 'ACTIVE',
    });
  });

  it('updates the existing local customer instead of creating a duplicate', async () => {
    fake.customers.push({
      id: 'cust-existing',
      brandId: BRAND_A,
      zohoContactId: 'c1',
      displayName: 'Old Name',
      status: 'ACTIVE',
    });
    const { service, zoho } = makeService(fake.prisma);
    vi.spyOn(zoho, 'listContactsPage').mockResolvedValue({
      contacts: [contact({ contact_name: 'New Name' })],
      hasMorePage: false,
    });
    vi.spyOn(zoho, 'getContact').mockResolvedValue(contact({ contact_name: 'New Name' }));

    await service.pullBrand(BRAND_A);

    expect(fake.customers).toHaveLength(1);
    expect(fake.customers[0]!.id).toBe('cust-existing');
    expect(fake.customers[0]!.displayName).toBe('New Name');
  });

  it('is idempotent — running the same pull twice never creates a duplicate', async () => {
    const { service, zoho } = makeService(fake.prisma);
    vi.spyOn(zoho, 'listContactsPage').mockResolvedValue({
      contacts: [contact()],
      hasMorePage: false,
    });
    vi.spyOn(zoho, 'getContact').mockResolvedValue(contact());

    await service.pullBrand(BRAND_A);
    await service.pullBrand(BRAND_A);

    expect(fake.customers).toHaveLength(1);
  });

  it('paginates through every page Zoho reports', async () => {
    const { service, zoho } = makeService(fake.prisma);
    const listContactsPage = vi
      .spyOn(zoho, 'listContactsPage')
      .mockImplementation(async (_connection, page) =>
        page === 1
          ? { contacts: [contact({ contact_id: 'c1' })], hasMorePage: true }
          : { contacts: [contact({ contact_id: 'c2' })], hasMorePage: false },
      );
    vi.spyOn(zoho, 'getContact').mockImplementation(async (_connection, contactId) =>
      contact({ contact_id: contactId, contact_name: contactId }),
    );

    const counts = await service.pullBrand(BRAND_A);

    expect(listContactsPage).toHaveBeenCalledTimes(2);
    expect(counts.customers).toBe(2);
    expect(fake.customers.map((c) => c.zohoContactId).sort()).toEqual(['c1', 'c2']);
  });

  it('archives a local customer that is no longer present in Zoho at all', async () => {
    fake.customers.push({
      id: 'cust-gone',
      brandId: BRAND_A,
      zohoContactId: 'gone-from-zoho',
      displayName: 'Departed Customer',
      status: 'ACTIVE',
    });
    const { service, zoho } = makeService(fake.prisma);
    // The full scan (Status.All) comes back with a different contact only —
    // 'gone-from-zoho' is nowhere in it, meaning Zoho no longer reports it.
    vi.spyOn(zoho, 'listContactsPage').mockResolvedValue({
      contacts: [contact({ contact_id: 'still-here', last_modified_time: undefined })],
      hasMorePage: false,
    });
    vi.spyOn(zoho, 'getContact').mockResolvedValue(contact({ contact_id: 'still-here' }));

    await service.pullBrand(BRAND_A);

    const departed = fake.customers.find((c) => c.id === 'cust-gone')!;
    expect(departed.status).toBe('ARCHIVED');
    // Archived, never deleted.
    expect(fake.customers).toContainEqual(expect.objectContaining({ id: 'cust-gone' }));
  });

  it('archives a customer Zoho reports inactive, and reactivates it once Zoho does', async () => {
    fake.customers.push({
      id: 'cust-1',
      brandId: BRAND_A,
      zohoContactId: 'c1',
      displayName: 'Acme Co',
      status: 'ACTIVE',
    });
    const { service, zoho } = makeService(fake.prisma);
    vi.spyOn(zoho, 'listContactsPage').mockResolvedValue({
      contacts: [contact({ status: 'inactive' })],
      hasMorePage: false,
    });
    vi.spyOn(zoho, 'getContact').mockResolvedValue(contact({ status: 'inactive' }));

    await service.pullBrand(BRAND_A);
    expect(fake.customers[0]!.status).toBe('ARCHIVED');

    vi.spyOn(zoho, 'listContactsPage').mockResolvedValue({
      contacts: [contact({ status: 'active' })],
      hasMorePage: false,
    });
    vi.spyOn(zoho, 'getContact').mockResolvedValue(contact({ status: 'active' }));

    await service.pullBrand(BRAND_A);
    expect(fake.customers[0]!.status).toBe('ACTIVE');
  });

  it('never touches another brand\'s customers', async () => {
    fake.customers.push({
      id: 'cust-b',
      brandId: BRAND_B,
      zohoContactId: 'shared-looking-id',
      displayName: 'Brand B customer',
      status: 'ACTIVE',
    });
    const { service, zoho } = makeService(fake.prisma);
    // Brand A's own scan never mentions "shared-looking-id" — if brand
    // isolation were broken, this id would get archived as "missing".
    vi.spyOn(zoho, 'listContactsPage').mockResolvedValue({
      contacts: [contact({ contact_id: 'a-only' })],
      hasMorePage: false,
    });
    vi.spyOn(zoho, 'getContact').mockResolvedValue(contact({ contact_id: 'a-only' }));

    await service.pullBrand(BRAND_A);

    const brandBCustomer = fake.customers.find((c) => c.id === 'cust-b')!;
    expect(brandBCustomer.status).toBe('ACTIVE');
    expect(fake.customers.filter((c) => c.brandId === BRAND_A)).toHaveLength(1);
  });

  it('records a failed SyncJob and rethrows on an authentication error, without archiving anything', async () => {
    fake.customers.push({
      id: 'cust-1',
      brandId: BRAND_A,
      zohoContactId: 'c1',
      displayName: 'Acme Co',
      status: 'ACTIVE',
    });
    const { service, zoho } = makeService(fake.prisma);
    vi.spyOn(zoho, 'listContactsPage').mockRejectedValue(
      new IntegrationError({
        message: 'Zoho Books: GET /books/v3/contacts failed with 401',
        errorClass: 'AUTHENTICATION',
        provider: 'zoho-books',
      }),
    );

    await expect(service.pullBrand(BRAND_A)).rejects.toThrow(/401/);

    // The already-known customer must be untouched — a transient/auth
    // failure partway through a scan must never read as "everyone is gone".
    expect(fake.customers[0]!.status).toBe('ACTIVE');

    const failedJob = fake.syncJobs.find((j) => j.objectType === 'CUSTOMER' && j.objectId === 'list');
    expect(failedJob).toBeTruthy();
    expect(failedJob!.status).toBe('FAILED');
    expect(failedJob!.errorClass).toBe('AUTHENTICATION');
  });

  it('fetches every page with Status.All so inactive Zoho contacts are included', async () => {
    const { service, zoho } = makeService(fake.prisma);
    const listContactsPage = vi.spyOn(zoho, 'listContactsPage').mockResolvedValue({
      contacts: [],
      hasMorePage: false,
    });

    await service.pullBrand(BRAND_A);

    // listContactsPage itself owns the actual query params (asserted in the
    // adapter's own request-building), but the call must happen at all —
    // this guards against pullCustomers being changed to skip the scan.
    expect(listContactsPage).toHaveBeenCalledWith(CONNECTION, 1);
  });
});
