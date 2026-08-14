import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Customer } from '@prisma/client';
import type { CustomerInput, CustomerListQuery, Scope } from '@fenwick/shared';
import { PrismaService, type ScopedClient } from '../infra/prisma/prisma.service.js';
import { QueueService } from '../infra/queue/queue.service.js';

/** A row's outstanding balance, invoice count and settled-payment count — the
 * three figures the listing table shows per customer (FR-CUS list view). */
export interface CustomerListRow extends Customer {
  readonly outstandingMinor: number;
  readonly invoiceCount: number;
  readonly paymentCount: number;
}

export interface CustomerListResult {
  readonly data: CustomerListRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** Payment statuses that count as "collected" for the list view's Payments
 * column — mirrors the settled/terminal split invoices.service.ts already
 * draws using PAYABLE_STATUSES (@fenwick/shared) and the rest. */
const COLLECTED_PAYMENT_STATUSES = ['SETTLED'] as const;

/**
 * Customers (FR-CUS). Every method runs inside PrismaService.withScope, which
 * is the only path to this table — row-level security is the backstop, this
 * is the layer that keeps a query from being attempted unscoped at all.
 *
 * "Not found" covers both "does not exist" and "exists but RLS hid it": the
 * two are indistinguishable on purpose (NFR-SEC-025 — no resource leakage).
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async list(scope: Scope, brandId: string, query: CustomerListQuery): Promise<CustomerListResult> {
    return this.prisma.withScope(scope, async (tx) => {
      const where: Prisma.CustomerWhereInput = { brandId };

      if (query.search) {
        const search = query.search;
        where.OR = [
          { displayName: { contains: search, mode: 'insensitive' } },
          { companyName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (query.dateRange && (query.dateRange.from || query.dateRange.to)) {
        where.createdAt = {
          ...(query.dateRange.from ? { gte: query.dateRange.from } : {}),
          ...(query.dateRange.to ? { lte: query.dateRange.to } : {}),
        };
      }

      if (query.hasOutstanding !== undefined) {
        const outstandingClause: Prisma.InvoiceListRelationFilter = {
          [query.hasOutstanding ? 'some' : 'none']: {
            balanceMinor: { gt: 0n },
            status: { notIn: ['PAID', 'CANCELLED'] },
          },
        };
        where.invoices = outstandingClause;
      }

      const [data, total] = await Promise.all([
        tx.customer.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.customer.count({ where }),
      ]);

      const enriched = await this.withInvoiceStats(tx, data);
      return { data: enriched, page: query.page, pageSize: query.pageSize, total };
    });
  }

  /**
   * Attaches outstanding balance, invoice count and settled-payment count to
   * a page of customers — three SUMs the list query itself can't produce
   * without fanning the row out per invoice. `balanceMinor` is already 0 on
   * a paid or cancelled invoice (it's stored, not derived — see the Invoice
   * model), so summing it unconditionally across every invoice is correct
   * without a status filter.
   *
   * Payments have no customerId of their own (only invoiceId), so a second
   * query maps invoice → customer before the payment counts can be folded in.
   */
  private async withInvoiceStats(
    tx: ScopedClient,
    customers: Customer[],
  ): Promise<CustomerListRow[]> {
    const customerIds = customers.map((c) => c.id);
    if (customerIds.length === 0) return [];

    const [invoiceAgg, invoices] = await Promise.all([
      tx.invoice.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds } },
        _count: { _all: true },
        _sum: { balanceMinor: true },
      }),
      tx.invoice.findMany({
        where: { customerId: { in: customerIds } },
        select: { id: true, customerId: true },
      }),
    ]);

    const invoiceIds = invoices.map((i) => i.id);
    const paymentAgg = invoiceIds.length
      ? await tx.payment.groupBy({
          by: ['invoiceId'],
          where: {
            invoiceId: { in: invoiceIds },
            status: { in: [...COLLECTED_PAYMENT_STATUSES] },
          },
          _count: { _all: true },
        })
      : [];

    const customerIdByInvoiceId = new Map(invoices.map((i) => [i.id, i.customerId]));
    const paymentCountByCustomer = new Map<string, number>();
    for (const row of paymentAgg) {
      const customerId = customerIdByInvoiceId.get(row.invoiceId);
      if (!customerId) continue;
      paymentCountByCustomer.set(
        customerId,
        (paymentCountByCustomer.get(customerId) ?? 0) + row._count._all,
      );
    }

    const invoiceCountByCustomer = new Map(invoiceAgg.map((r) => [r.customerId, r._count._all]));
    const outstandingByCustomer = new Map(
      invoiceAgg.map((r) => [r.customerId, r._sum.balanceMinor ?? 0n]),
    );

    return customers.map((c) => ({
      ...c,
      invoiceCount: invoiceCountByCustomer.get(c.id) ?? 0,
      paymentCount: paymentCountByCustomer.get(c.id) ?? 0,
      outstandingMinor: Number(outstandingByCustomer.get(c.id) ?? 0n),
    }));
  }

  async findOne(scope: Scope, brandId: string, id: string): Promise<Customer> {
    const customer = await this.prisma.withScope(scope, (tx) =>
      tx.customer.findFirst({ where: { id, brandId } }),
    );
    if (!customer) throw new NotFoundException('customer not found');
    return customer;
  }

  async create(scope: Scope, brandId: string, input: CustomerInput): Promise<Customer> {
    const customer = await this.prisma.withScope(scope, async (tx) => {
      try {
        return await tx.customer.create({
          data: {
            brandId,
            type: input.type,
            salutation: input.salutation,
            firstName: input.firstName,
            lastName: input.lastName,
            companyName: input.companyName,
            displayName: input.displayName,
            email: input.email,
            phone: input.phone,
            billingAddress: input.billingAddress ?? Prisma.JsonNull,
            shippingAddress: input.shippingAddress ?? Prisma.JsonNull,
          },
        });
      } catch (error) {
        throw this.translateWriteError(error);
      }
    });

    // Enqueued after the transaction commits — a rollback above must never
    // leave a sync job pointing at a customer that does not exist.
    await this.queue.enqueue('sync', 'zoho-push-customer', { brandId, customerId: customer.id });

    return customer;
  }

  async update(scope: Scope, brandId: string, id: string, input: CustomerInput): Promise<Customer> {
    return this.prisma.withScope(scope, async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id, brandId } });
      if (!existing) throw new NotFoundException('customer not found');

      try {
        return await tx.customer.update({
          where: { id },
          data: {
            type: input.type,
            salutation: input.salutation,
            firstName: input.firstName,
            lastName: input.lastName,
            companyName: input.companyName,
            displayName: input.displayName,
            email: input.email,
            phone: input.phone,
            billingAddress: input.billingAddress ?? Prisma.JsonNull,
            shippingAddress: input.shippingAddress ?? Prisma.JsonNull,
          },
        });
      } catch (error) {
        throw this.translateWriteError(error);
      }
    });
  }

  /**
   * Postgres reports a WITH CHECK failure as a bare "row-level security
   * policy" error, not a typed Prisma error — this is the only place that
   * text is inspected, and only to avoid leaking a raw SQL error to a client.
   */
  private translateWriteError(error: unknown): Error {
    if (PrismaService.isUniqueViolation(error)) {
      return new ConflictException('a customer with this identifier already exists');
    }
    if (error instanceof Error && /row-level security/i.test(error.message)) {
      return new ForbiddenException('insufficient permissions for this brand');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
