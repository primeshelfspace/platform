/**
 * PublicInvoicesService against a real database (TDD-001 §12.1). The token
 * resolution here is the entire security model of the anonymous payment
 * path, so it is exercised against real RLS rather than mocked. Needs a
 * migrated, seeded database:
 *   pnpm setup:local && pnpm --filter @fenwick/api test
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomerInput, InvoiceDraftInput, PublicScope, RequestScope } from '@fenwick/shared';
import { loadEnv } from '../config/load-env.js';
import { getEnv } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { createFakeQueueService } from '../infra/queue/fake-queue.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { StripeAccountService } from '../integrations/stripe-account.service.js';
import { LocalDiskAdapter } from '../adapters/storage/local-disk.adapter.js';
import { PublicInvoicesService } from './public-invoices.service.js';

loadEnv();
const hasDb = Boolean(process.env['DATABASE_URL']);
const env = hasDb ? getEnv() : null;
const describeWithDb = hasDb ? describe : describe.skip;

describeWithDb('PublicInvoicesService', () => {
  const prisma = new PrismaService(env!);
  const queue = createFakeQueueService();
  const customers = new CustomersService(prisma, queue);
  const invoices = new InvoicesService(prisma, queue);
  // Local disk is the right storage here: these tests assert invoice data, and
  // a real bucket would make them depend on credentials and the network.
  const publicInvoices = new PublicInvoicesService(
    prisma,
    new StripeAccountService(prisma, env!),
    new LocalDiskAdapter(env!),
  );
  const owner = new PrismaClient({
    datasources: { db: { url: env!.DIRECT_DATABASE_URL ?? env!.DATABASE_URL } },
  });

  let solsticeId = '';
  let northgateId = '';
  let ownerScope: RequestScope;
  // Northgate is a different merchant entirely, not just a different brand
  // in the same one — creating its fixture needs its own owner scope, since
  // ownerScope (Fenwick) is correctly refused write access to it by RLS.
  let northgateOwnerScope: RequestScope;

  beforeAll(async () => {
    const brand = await owner.brand.findFirst({
      where: { displayName: 'Cobalt Studio Supply' },
      select: { id: true, merchantId: true },
    });
    const northgate = await owner.brand.findFirst({
      where: { displayName: 'Northgate' },
      select: { id: true, merchantId: true },
    });
    if (!brand || !northgate) throw new Error('seed data missing — run pnpm db:seed');
    solsticeId = brand.id;
    northgateId = northgate.id;
    ownerScope = {
      merchantId: brand.merchantId,
      userId: 'test-harness',
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'test-session',
      sourceIp: null,
    };
    northgateOwnerScope = {
      merchantId: northgate.merchantId,
      userId: 'test-harness-northgate',
      role: 'MERCHANT_OWNER',
      assignedBrandIds: [],
      sessionId: 'test-session-northgate',
      sourceIp: null,
    };
  });

  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), owner.$disconnect()]);
  });

  async function issuedInvoice(
    brandId: string = solsticeId,
  ): Promise<{ id: string; publicToken: string }> {
    const scope = brandId === northgateId ? northgateOwnerScope : ownerScope;
    const customerInput: CustomerInput = {
      type: 'BUSINESS',
      salutation: null,
      firstName: null,
      lastName: null,
      companyName: `Public Test Co ${randomUUID().slice(0, 8)}`,
      displayName: `Public Test Co ${randomUUID().slice(0, 8)}`,
      email: 'ap@public-test.example',
      phone: null,
      billingAddress: null,
      shippingAddress: null,
    };
    const customer = await customers.create(scope, brandId, customerInput);
    const draft: InvoiceDraftInput = {
      brandId,
      customerId: customer.id,
      invoiceDate: new Date('2026-01-01'),
      dueDate: new Date('2026-01-31'),
      currency: 'USD',
      lines: [
        {
          itemName: 'Test item',
          description: null,
          quantity: '1',
          unitPrice: '50.00',
          taxExempt: true,
        },
      ],
      taxRateBp: 0,
      cardFeeRateBp: 0,
      notes: null,
      internalNotes: null,
    };
    const created = await invoices.create(scope, brandId, draft);
    const issued = await invoices.issue(scope, brandId, created.id);
    return { id: issued.id, publicToken: issued.publicToken };
  }

  it('resolves a valid, active token to the correct brand and invoice', async () => {
    const { id, publicToken } = await issuedInvoice();
    const scope = await publicInvoices.resolveScope(publicToken);
    expect(scope).not.toBeNull();
    expect(scope!.brandId).toBe(solsticeId);
    expect(scope!.invoiceId).toBe(id);
  });

  it('returns null for a token that does not exist, indistinguishable from a deactivated one', async () => {
    const scope = await publicInvoices.resolveScope('0'.repeat(32));
    expect(scope).toBeNull();
  });

  it('returns null once the token is deactivated, even though the invoice still exists', async () => {
    const { id, publicToken } = await issuedInvoice();
    await owner.invoice.update({ where: { id }, data: { publicTokenActive: false } });

    const scope = await publicInvoices.resolveScope(publicToken);
    expect(scope).toBeNull();
  });

  it('transitions SENT to VIEWED on first view and never fires again on subsequent views', async () => {
    const { publicToken } = await issuedInvoice();
    const scope = (await publicInvoices.resolveScope(publicToken))!;

    const first = await publicInvoices.view(scope);
    expect(first!.status).toBe('VIEWED');

    const events = await owner.invoiceEvent.findMany({
      where: { invoiceId: scope.invoiceId, eventType: 'FIRST_VIEW' },
    });
    expect(events).toHaveLength(1);

    const second = await publicInvoices.view(scope);
    expect(second!.status).toBe('VIEWED');
    const eventsAfterSecondView = await owner.invoiceEvent.findMany({
      where: { invoiceId: scope.invoiceId, eventType: 'FIRST_VIEW' },
    });
    expect(eventsAfterSecondView).toHaveLength(1); // still exactly one — did not re-fire
  });

  it('projects quantity back to a human decimal string, not the scaled integer', async () => {
    const { publicToken } = await issuedInvoice();
    const scope = (await publicInvoices.resolveScope(publicToken))!;
    const view = await publicInvoices.view(scope);
    expect(view!.lines[0]?.quantity).toBe('1');
  });

  it("refuses to view a foreign brand's invoice even if a scope is hand-built to target it", async () => {
    const { id: solsticeInvoiceId } = await issuedInvoice(solsticeId);
    const { id: northgateInvoiceId } = await issuedInvoice(northgateId);

    // Not reachable through resolveScope (it always derives brandId from the
    // token's own row) — this simulates a bug elsewhere handing view() a
    // scope whose claimed brand and target invoice have been mixed up, to
    // prove RLS is the backstop even then, not just the resolver's care.
    const confusedScope: PublicScope = {
      kind: 'PUBLIC',
      merchantId: ownerScope.merchantId,
      brandId: solsticeId,
      invoiceId: northgateInvoiceId,
      sourceIp: null,
    };
    expect(await publicInvoices.view(confusedScope)).toBeNull();

    // The honestly-resolved scope for the same invoice still works, proving
    // the null above is RLS denial and not some unrelated lookup failure.
    const legitimate = await publicInvoices.resolveScope(
      (
        await owner.invoice.findUniqueOrThrow({
          where: { id: solsticeInvoiceId },
          select: { publicToken: true },
        })
      ).publicToken,
    );
    expect(await publicInvoices.view(legitimate!)).not.toBeNull();
  });
});
