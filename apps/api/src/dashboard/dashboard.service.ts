import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { InvoiceStatus } from '@prisma/client';
import {
  PAYABLE_STATUSES,
  formatMinorForDisplay,
  toCurrencyCode,
  type CurrencyCode,
  type Scope,
} from '@fenwick/shared';
import { PrismaService, type ScopedClient } from '../infra/prisma/prisma.service.js';
import { QueueService } from '../infra/queue/queue.service.js';

const DRAFT_UNSENT_ATTENTION_DAYS = 3;
const DUE_SOON_HOURS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DashboardSummary {
  readonly currency: CurrencyCode;
  readonly invoicedMinor: number;
  readonly collectedMinor: number;
  /** 0..1 */
  readonly collectionRate: number;
  /** As of today, not month-scoped. */
  readonly overdueMinor: number;
  /** Readable brands whose own currency differs from `currency` — their
   * activity is not represented in the totals above, rather than silently
   * mixed into them. */
  readonly otherCurrencyBrandCount: number;
}

export interface DashboardTrendPoint {
  readonly month: string;
  readonly label: string;
  readonly invoicedMinor: number;
  readonly collectedMinor: number;
  readonly collectionRate: number;
}

export const STATUS_BUCKET_ORDER = ['Paid', 'Unpaid', 'Overdue', 'Partially Paid', 'Draft'] as const;
export type StatusBucket = (typeof STATUS_BUCKET_ORDER)[number];

export interface DashboardStatusBucket {
  readonly bucket: StatusBucket;
  readonly amountMinor: number;
  /** 0..1, of the total across all buckets shown. */
  readonly percent: number;
}

export interface TopOverdueCustomer {
  readonly customerId: string;
  readonly displayName: string;
  readonly brandId: string;
  /** Only populated when brandId was omitted from the request. */
  readonly brandName: string | null;
  readonly balanceMinor: number;
  readonly daysOverdue: number;
}

export type NeedsAttentionKind = 'STALE_DRAFT' | 'DUE_SOON' | 'SYNC_FAILED';

export interface NeedsAttentionItem {
  readonly kind: NeedsAttentionKind;
  readonly brandId: string;
  readonly brandName: string | null;
  readonly invoiceNumber: string | null;
  readonly subject: string;
  readonly detail: string;
  readonly invoiceId: string | null;
  readonly syncJobId: string | null;
  readonly occurredAt: Date;
}

export interface NeedsAttentionResult {
  readonly items: readonly NeedsAttentionItem[];
  readonly totalCount: number;
}

export type RecentActivityKind = 'PAYMENT_RECEIVED' | 'INVOICE_SENT' | 'CUSTOMER_ADDED';

export interface RecentActivityItem {
  readonly kind: RecentActivityKind;
  readonly brandId: string;
  readonly brandName: string | null;
  readonly message: string;
  readonly occurredAt: Date;
}

export interface BrandRollup {
  readonly brandId: string;
  readonly brandName: string;
  readonly themeColor: string;
  readonly currency: CurrencyCode;
  readonly invoicedMinor: number;
  readonly collectedMinor: number;
  readonly collectionRate: number;
  readonly overdueMinor: number;
}

export interface CrossBrandCustomerRow {
  readonly email: string;
  readonly displayName: string;
  readonly perBrand: Readonly<Record<string, { brandName: string; status: string | null }>>;
}

export interface CrossBrandCustomersResult {
  readonly rows: readonly CrossBrandCustomerRow[];
  readonly matchedCount: number;
}

/** Bucket a single invoice into the donut chart's five-way grouping. The
 * `overdue` overlay always wins over the raw status, same convention as
 * `invoiceListStatus` (packages/shared/src/tokens/tokens.ts) — this is a
 * distinct grouping from that one only because Partially Paid needs its own
 * slice here, where the list page collapses it into "Unpaid". */
export function bucketFor(status: InvoiceStatus, overdue: boolean): StatusBucket | null {
  if (status === 'CANCELLED') return null;
  if (overdue) return 'Overdue';
  if (status === 'DRAFT') return 'Draft';
  if (status === 'PAID') return 'Paid';
  if (status === 'PARTIALLY_PAID') return 'Partially Paid';
  return 'Unpaid'; // SENT | VIEWED | PENDING_PAYMENT
}

/** The last six calendar months' worth of names, in a compact key + a short
 * label, in UTC — nothing here is timezone-sensitive enough to warrant
 * resolving each brand's own timezone (BrandSettings.timezone) just to
 * decide which bucket a month boundary falls in. */
function monthBounds(monthsAgo: number): { start: Date; end: Date; key: string; label: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - monthsAgo;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  const label = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return { start, end, key, label };
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/**
 * Backing data for the admin dashboard (single-brand and "All Brands").
 *
 * Every method takes `brandId: string | null`. `null` is not "no filter
 * applied" in the unscoped-query sense — it means the WHERE clause omits
 * brandId entirely and PostgreSQL row-level security (pushed into the
 * session by PrismaService.withScope, see packages/shared/src/tenancy.ts)
 * restricts the result to exactly the brands the caller's role can read.
 * There is deliberately no separate "loop over every brand" code path here.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async getSummary(scope: Scope, brandId: string | null): Promise<DashboardSummary> {
    const { start, end } = monthBounds(0);
    return this.prisma.withScope(scope, async (tx) => {
      const [invoicedByCurrency, collectedByCurrency, overdueByCurrency] = await Promise.all([
        tx.invoice.groupBy({
          by: ['currency'],
          where: {
            issuedAt: { gte: start, lt: end },
            status: { not: 'CANCELLED' },
            ...(brandId ? { brandId } : {}),
          },
          _sum: { totalMinor: true },
        }),
        tx.payment.groupBy({
          by: ['currency'],
          where: {
            status: 'SETTLED',
            settledAt: { gte: start, lt: end },
            ...(brandId ? { brandId } : {}),
          },
          _sum: { amountMinor: true },
        }),
        tx.invoice.groupBy({
          by: ['currency'],
          where: { overdue: true, ...(brandId ? { brandId } : {}) },
          _sum: { balanceMinor: true },
        }),
      ]);

      const currencies = new Set([
        ...invoicedByCurrency.map((r) => r.currency),
        ...collectedByCurrency.map((r) => r.currency),
        ...overdueByCurrency.map((r) => r.currency),
      ]);
      if (currencies.size === 0) {
        return {
          currency: 'USD',
          invoicedMinor: 0,
          collectedMinor: 0,
          collectionRate: 0,
          overdueMinor: 0,
          otherCurrencyBrandCount: 0,
        };
      }

      // The currency with the largest invoiced total this month "wins" the
      // headline figures — the common case is every readable brand sharing
      // one currency, in which case this is simply that currency.
      let dominant = [...currencies][0]!;
      let dominantTotal = -1;
      for (const row of invoicedByCurrency) {
        const total = Number(row._sum.totalMinor ?? 0n);
        if (total > dominantTotal) {
          dominant = row.currency;
          dominantTotal = total;
        }
      }

      const invoicedMinor = Number(
        invoicedByCurrency.find((r) => r.currency === dominant)?._sum.totalMinor ?? 0n,
      );
      const collectedMinor = Number(
        collectedByCurrency.find((r) => r.currency === dominant)?._sum.amountMinor ?? 0n,
      );
      const overdueMinor = Number(
        overdueByCurrency.find((r) => r.currency === dominant)?._sum.balanceMinor ?? 0n,
      );
      const otherCurrencyBrandCount = brandId
        ? 0
        : await tx.brand.count({ where: { currency: { not: dominant } } });

      return {
        currency: toCurrencyCode(dominant),
        invoicedMinor,
        collectedMinor,
        collectionRate: invoicedMinor > 0 ? collectedMinor / invoicedMinor : 0,
        overdueMinor,
        otherCurrencyBrandCount,
      };
    });
  }

  async getTrend(scope: Scope, brandId: string | null): Promise<DashboardTrendPoint[]> {
    const months = Array.from({ length: 6 }, (_, i) => monthBounds(5 - i));
    const earliest = months[0]!.start;

    return this.prisma.withScope(scope, async (tx) => {
      const [invoiceRows, paymentRows] = await Promise.all([
        tx.invoice.findMany({
          where: {
            issuedAt: { gte: earliest },
            status: { not: 'CANCELLED' },
            ...(brandId ? { brandId } : {}),
          },
          select: { issuedAt: true, totalMinor: true },
        }),
        tx.payment.findMany({
          where: {
            status: 'SETTLED',
            settledAt: { gte: earliest },
            ...(brandId ? { brandId } : {}),
          },
          select: { settledAt: true, amountMinor: true },
        }),
      ]);

      return months.map(({ start, end, key, label }) => {
        const invoicedMinor = invoiceRows
          .filter((r) => r.issuedAt && r.issuedAt >= start && r.issuedAt < end)
          .reduce((sum, r) => sum + Number(r.totalMinor), 0);
        const collectedMinor = paymentRows
          .filter((r) => r.settledAt && r.settledAt >= start && r.settledAt < end)
          .reduce((sum, r) => sum + Number(r.amountMinor), 0);
        return {
          month: key,
          label,
          invoicedMinor,
          collectedMinor,
          collectionRate: invoicedMinor > 0 ? collectedMinor / invoicedMinor : 0,
        };
      });
    });
  }

  async getStatusBreakdown(scope: Scope, brandId: string | null): Promise<DashboardStatusBucket[]> {
    return this.prisma.withScope(scope, async (tx) => {
      const rows = await tx.invoice.groupBy({
        by: ['status', 'overdue'],
        where: { status: { not: 'CANCELLED' }, ...(brandId ? { brandId } : {}) },
        _sum: { totalMinor: true },
      });

      const totals = new Map<StatusBucket, number>();
      for (const row of rows) {
        const bucket = bucketFor(row.status, row.overdue);
        if (!bucket) continue;
        totals.set(bucket, (totals.get(bucket) ?? 0) + Number(row._sum.totalMinor ?? 0n));
      }
      const grandTotal = [...totals.values()].reduce((a, b) => a + b, 0);

      return STATUS_BUCKET_ORDER.filter((bucket) => totals.has(bucket)).map((bucket) => {
        const amountMinor = totals.get(bucket)!;
        return { bucket, amountMinor, percent: grandTotal > 0 ? amountMinor / grandTotal : 0 };
      });
    });
  }

  async getTopOverdueCustomers(
    scope: Scope,
    brandId: string | null,
  ): Promise<TopOverdueCustomer[]> {
    return this.prisma.withScope(scope, async (tx) => {
      const grouped = await tx.invoice.groupBy({
        by: ['customerId'],
        where: { overdue: true, ...(brandId ? { brandId } : {}) },
        _sum: { balanceMinor: true },
        _max: { dueDate: true },
        orderBy: { _sum: { balanceMinor: 'desc' } },
        take: 5,
      });
      if (grouped.length === 0) return [];

      const customers = await tx.customer.findMany({
        where: { id: { in: grouped.map((g) => g.customerId) } },
        select: {
          id: true,
          displayName: true,
          brandId: true,
          brand: { select: { displayName: true } },
        },
      });
      const byId = new Map(customers.map((c) => [c.id, c]));
      const today = new Date();

      const rows: TopOverdueCustomer[] = [];
      for (const g of grouped) {
        const customer = byId.get(g.customerId);
        if (!customer) continue; // RLS hid it, or it was deleted between queries
        rows.push({
          customerId: g.customerId,
          displayName: customer.displayName,
          brandId: customer.brandId,
          brandName: brandId ? null : customer.brand.displayName,
          balanceMinor: Number(g._sum.balanceMinor ?? 0n),
          daysOverdue: g._max.dueDate ? daysBetween(g._max.dueDate, today) : 0,
        });
      }
      return rows;
    });
  }

  async getNeedsAttention(scope: Scope, brandId: string | null): Promise<NeedsAttentionResult> {
    return this.prisma.withScope(scope, async (tx) => {
      const now = new Date();
      const staleCutoff = new Date(now.getTime() - DRAFT_UNSENT_ATTENTION_DAYS * DAY_MS);
      const dueSoonCutoff = new Date(now.getTime() + DUE_SOON_HOURS * 60 * 60 * 1000);

      const [staleDrafts, dueSoon, failedJobs] = await Promise.all([
        tx.invoice.findMany({
          where: {
            status: 'DRAFT',
            createdAt: { lte: staleCutoff },
            ...(brandId ? { brandId } : {}),
          },
          orderBy: { createdAt: 'asc' },
          take: 20,
          select: {
            id: true,
            number: true,
            createdAt: true,
            brandId: true,
            brand: { select: { displayName: true } },
            customer: { select: { displayName: true } },
          },
        }),
        tx.invoice.findMany({
          where: {
            status: { in: [...PAYABLE_STATUSES] },
            dueDate: { gte: now, lte: dueSoonCutoff },
            ...(brandId ? { brandId } : {}),
          },
          orderBy: { dueDate: 'asc' },
          take: 20,
          select: {
            id: true,
            number: true,
            dueDate: true,
            brandId: true,
            brand: { select: { displayName: true } },
            customer: { select: { displayName: true } },
          },
        }),
        tx.syncJob.findMany({
          where: {
            status: { in: ['FAILED', 'DEAD_LETTERED'] },
            ...(brandId ? { brandId } : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: 20,
          select: {
            id: true,
            brandId: true,
            objectType: true,
            objectId: true,
            lastError: true,
            updatedAt: true,
            brand: { select: { displayName: true } },
          },
        }),
      ]);

      // Failed jobs on an INVOICE or CUSTOMER carry that object's id — resolve
      // it to a real invoice number / customer name for display, batched
      // rather than one lookup per job.
      const invoiceIds = failedJobs
        .filter((j) => j.objectType === 'INVOICE' && j.objectId)
        .map((j) => j.objectId!);
      const customerIds = failedJobs
        .filter((j) => j.objectType === 'CUSTOMER' && j.objectId)
        .map((j) => j.objectId!);
      const [jobInvoices, jobCustomers] = await Promise.all([
        invoiceIds.length
          ? tx.invoice.findMany({
              where: { id: { in: invoiceIds } },
              select: { id: true, number: true, customer: { select: { displayName: true } } },
            })
          : Promise.resolve([]),
        customerIds.length
          ? tx.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, displayName: true } })
          : Promise.resolve([]),
      ]);
      const invoiceById = new Map(jobInvoices.map((i) => [i.id, i]));
      const customerById = new Map(jobCustomers.map((c) => [c.id, c]));

      const items: NeedsAttentionItem[] = [
        ...failedJobs.map((job): NeedsAttentionItem => {
          const invoice = job.objectType === 'INVOICE' && job.objectId ? invoiceById.get(job.objectId) : undefined;
          const customer = job.objectType === 'CUSTOMER' && job.objectId ? customerById.get(job.objectId) : undefined;
          return {
            kind: 'SYNC_FAILED',
            brandId: job.brandId,
            brandName: brandId ? null : job.brand.displayName,
            invoiceNumber: invoice?.number ?? null,
            subject: invoice?.customer.displayName ?? customer?.displayName ?? `${job.objectType.toLowerCase()} sync`,
            detail: 'Zoho sync failed' + (job.lastError ? ` — ${job.lastError}` : ''),
            invoiceId: invoice?.id ?? null,
            syncJobId: job.id,
            occurredAt: job.updatedAt,
          };
        }),
        ...dueSoon.map(
          (inv): NeedsAttentionItem => ({
            kind: 'DUE_SOON',
            brandId: inv.brandId,
            brandName: brandId ? null : inv.brand.displayName,
            invoiceNumber: inv.number,
            subject: inv.customer.displayName,
            detail: 'Payment due within 24 hours',
            invoiceId: inv.id,
            syncJobId: null,
            occurredAt: inv.dueDate,
          }),
        ),
        ...staleDrafts.map(
          (inv): NeedsAttentionItem => ({
            kind: 'STALE_DRAFT',
            brandId: inv.brandId,
            brandName: brandId ? null : inv.brand.displayName,
            invoiceNumber: inv.number,
            subject: inv.customer.displayName,
            detail: `Draft unsent for ${daysBetween(inv.createdAt, now)} days`,
            invoiceId: inv.id,
            syncJobId: null,
            occurredAt: inv.createdAt,
          }),
        ),
      ];

      return { items: items.slice(0, 5), totalCount: items.length };
    });
  }

  async getRecentActivity(scope: Scope, brandId: string | null): Promise<RecentActivityItem[]> {
    return this.prisma.withScope(scope, async (tx) => {
      const [payments, issued, customers] = await Promise.all([
        tx.payment.findMany({
          where: { status: 'SETTLED', ...(brandId ? { brandId } : {}) },
          orderBy: { settledAt: 'desc' },
          take: 10,
          select: {
            amountMinor: true,
            currency: true,
            settledAt: true,
            brandId: true,
            brand: { select: { displayName: true } },
            invoice: { select: { customer: { select: { displayName: true } } } },
          },
        }),
        tx.invoiceEvent.findMany({
          where: { eventType: 'ISSUE', ...(brandId ? { invoice: { brandId } } : {}) },
          orderBy: { occurredAt: 'desc' },
          take: 10,
          select: {
            occurredAt: true,
            invoice: {
              select: {
                number: true,
                brandId: true,
                brand: { select: { displayName: true } },
                customer: { select: { displayName: true } },
              },
            },
          },
        }),
        tx.customer.findMany({
          where: { ...(brandId ? { brandId } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            displayName: true,
            createdAt: true,
            brandId: true,
            brand: { select: { displayName: true } },
          },
        }),
      ]);

      const items: RecentActivityItem[] = [
        ...payments
          .filter((p) => p.settledAt)
          .map(
            (p): RecentActivityItem => ({
              kind: 'PAYMENT_RECEIVED',
              brandId: p.brandId,
              brandName: brandId ? null : p.brand.displayName,
              message: `Payment of ${formatMinorForDisplay(Number(p.amountMinor), toCurrencyCode(p.currency))} received from ${p.invoice.customer.displayName}`,
              occurredAt: p.settledAt!,
            }),
          ),
        ...issued.map(
          (e): RecentActivityItem => ({
            kind: 'INVOICE_SENT',
            brandId: e.invoice.brandId,
            brandName: brandId ? null : e.invoice.brand.displayName,
            message: `Invoice ${e.invoice.number} sent to ${e.invoice.customer.displayName}`,
            occurredAt: e.occurredAt,
          }),
        ),
        ...customers.map(
          (c): RecentActivityItem => ({
            kind: 'CUSTOMER_ADDED',
            brandId: c.brandId,
            brandName: brandId ? null : c.brand.displayName,
            message: `New customer ${c.displayName} added`,
            occurredAt: c.createdAt,
          }),
        ),
      ];

      items.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      return items.slice(0, 10);
    });
  }

  /** brandId is always omitted here — a per-brand rollup scoped to one brand
   * is a contradiction in terms. */
  async getByBrand(scope: Scope): Promise<BrandRollup[]> {
    const { start, end } = monthBounds(0);
    return this.prisma.withScope(scope, async (tx) => {
      const [brands, invoiced, collected, overdue] = await Promise.all([
        tx.brand.findMany({ orderBy: { createdAt: 'asc' } }),
        tx.invoice.groupBy({
          by: ['brandId'],
          where: { issuedAt: { gte: start, lt: end }, status: { not: 'CANCELLED' } },
          _sum: { totalMinor: true },
        }),
        tx.payment.groupBy({
          by: ['brandId'],
          where: { status: 'SETTLED', settledAt: { gte: start, lt: end } },
          _sum: { amountMinor: true },
        }),
        tx.invoice.groupBy({
          by: ['brandId'],
          where: { overdue: true },
          _sum: { balanceMinor: true },
        }),
      ]);

      const invoicedMap = new Map(invoiced.map((r) => [r.brandId, Number(r._sum.totalMinor ?? 0n)]));
      const collectedMap = new Map(collected.map((r) => [r.brandId, Number(r._sum.amountMinor ?? 0n)]));
      const overdueMap = new Map(overdue.map((r) => [r.brandId, Number(r._sum.balanceMinor ?? 0n)]));

      return brands.map((brand): BrandRollup => {
        const invoicedMinor = invoicedMap.get(brand.id) ?? 0;
        const collectedMinor = collectedMap.get(brand.id) ?? 0;
        return {
          brandId: brand.id,
          brandName: brand.displayName,
          themeColor: brand.themeColor,
          currency: toCurrencyCode(brand.currency),
          invoicedMinor,
          collectedMinor,
          collectionRate: invoicedMinor > 0 ? collectedMinor / invoicedMinor : 0,
          overdueMinor: overdueMap.get(brand.id) ?? 0,
        };
      });
    });
  }

  /** Customers matched by email across two or more of the caller's readable
   * brands. Customer rows have no merchant-wide identity (Customer is
   * brand-owned, see schema.prisma) — email is the only real signal
   * available, so this is a best-effort match, not a guaranteed one. Bounded
   * to 20 matched customers, which is generous at this app's scale. */
  async getCrossBrandCustomers(scope: Scope): Promise<CrossBrandCustomersResult> {
    return this.prisma.withScope(scope, async (tx) => {
      const customers = await tx.customer.findMany({
        where: { email: { not: null }, status: 'ACTIVE' },
        select: {
          id: true,
          brandId: true,
          email: true,
          displayName: true,
          brand: { select: { displayName: true } },
        },
      });

      const byEmail = new Map<string, typeof customers>();
      for (const customer of customers) {
        const key = customer.email!.trim().toLowerCase();
        const group = byEmail.get(key);
        if (group) group.push(customer);
        else byEmail.set(key, [customer]);
      }

      const matched = [...byEmail.entries()].filter(([, group]) => group.length >= 2);
      const matchedCount = matched.length;
      const limited = matched.slice(0, 20);

      const allCustomerIds = limited.flatMap(([, group]) => group.map((c) => c.id));
      const latestInvoices = allCustomerIds.length
        ? await tx.invoice.findMany({
            where: { customerId: { in: allCustomerIds } },
            orderBy: { createdAt: 'desc' },
            select: { customerId: true, status: true, overdue: true },
          })
        : [];
      const latestByCustomer = new Map<string, { status: InvoiceStatus; overdue: boolean }>();
      for (const invoice of latestInvoices) {
        if (!latestByCustomer.has(invoice.customerId)) latestByCustomer.set(invoice.customerId, invoice);
      }

      const rows: CrossBrandCustomerRow[] = limited.map(([email, group]) => {
        const perBrand: Record<string, { brandName: string; status: string | null }> = {};
        for (const customer of group) {
          const latest = latestByCustomer.get(customer.id);
          perBrand[customer.brandId] = {
            brandName: customer.brand.displayName,
            status: latest ? (bucketFor(latest.status, latest.overdue) ?? latest.status) : null,
          };
        }
        return { email, displayName: group[0]!.displayName, perBrand };
      });

      return { rows, matchedCount };
    });
  }

  /**
   * Re-enqueues one failed SyncJob for real — not a stub. PUSH jobs replay
   * as the same per-object push job the original sync used (worker.ts);
   * PULL jobs re-run a forced full pull for that job's brand, since a pull
   * is inherently brand-wide rather than per-object.
   */
  async retrySyncJob(scope: Scope, jobId: string): Promise<{ queued: true }> {
    const job = await this.prisma.withScope(scope, (tx: ScopedClient) =>
      tx.syncJob.findFirst({ where: { id: jobId } }),
    );
    if (!job) throw new NotFoundException('sync job not found');

    if (job.direction === 'PULL') {
      await this.queue.enqueue('sync', 'zoho-pull-brand', { brandId: job.brandId, force: true });
      return { queued: true };
    }

    const retry =
      job.objectType === 'CUSTOMER'
        ? { jobName: 'zoho-push-customer', key: 'customerId' }
        : job.objectType === 'INVOICE'
          ? { jobName: 'zoho-push-invoice', key: 'invoiceId' }
          : job.objectType === 'PAYMENT'
            ? { jobName: 'zoho-push-payment', key: 'paymentId' }
            : null;

    if (!retry || !job.objectId) {
      throw new BadRequestException(`cannot retry a ${job.direction}/${job.objectType} sync job`);
    }

    await this.queue.enqueue('sync', retry.jobName, {
      brandId: job.brandId,
      [retry.key]: job.objectId,
    });
    return { queued: true };
  }
}
