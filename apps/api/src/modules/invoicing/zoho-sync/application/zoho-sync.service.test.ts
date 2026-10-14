/**
 * computeBackfillTargets is pure — no DB, no queue, no Zoho — so the
 * duplicate-push race it exists to close (see enqueueBackfill's doc comment
 * in zoho-sync.service.ts) can be checked directly against synthetic data.
 */
import { describe, expect, it } from 'vitest';
import { computeBackfillTargets } from './zoho-sync.service.js';

describe('computeBackfillTargets', () => {
  it('excludes a customer whose only invoice is being enqueued directly', () => {
    const result = computeBackfillTargets({
      payments: [],
      invoices: [{ id: 'inv-1', customerId: 'cust-1' }],
      customers: [{ id: 'cust-1' }],
    });

    expect(result.invoicesToEnqueue.map((i) => i.id)).toEqual(['inv-1']);
    expect(result.customersToEnqueue).toEqual([]);
  });

  it('excludes an invoice whose only settled payment is being enqueued directly, and its customer too', () => {
    const result = computeBackfillTargets({
      payments: [{ id: 'pay-1', invoiceId: 'inv-1', customerId: 'cust-1' }],
      invoices: [{ id: 'inv-1', customerId: 'cust-1' }],
      customers: [{ id: 'cust-1' }],
    });

    expect(result.payments.map((p) => p.id)).toEqual(['pay-1']);
    expect(result.invoicesToEnqueue).toEqual([]);
    expect(result.customersToEnqueue).toEqual([]);
  });

  it('enqueues a customer directly when it has no unsynced invoice at all', () => {
    const result = computeBackfillTargets({
      payments: [],
      invoices: [],
      customers: [{ id: 'cust-1' }],
    });

    expect(result.customersToEnqueue.map((c) => c.id)).toEqual(['cust-1']);
  });

  it('enqueues an invoice directly when it has no settled payment yet, alongside a separately-covered one', () => {
    const result = computeBackfillTargets({
      payments: [{ id: 'pay-1', invoiceId: 'inv-1', customerId: 'cust-1' }],
      invoices: [
        { id: 'inv-1', customerId: 'cust-1' },
        { id: 'inv-2', customerId: 'cust-1' },
      ],
      customers: [{ id: 'cust-1' }],
    });

    // inv-1 is covered by pay-1's cascade; inv-2 has no payment, so it stands
    // alone and must be queued directly. cust-1 is covered either way.
    expect(result.invoicesToEnqueue.map((i) => i.id)).toEqual(['inv-2']);
    expect(result.customersToEnqueue).toEqual([]);
  });

  it('never drops a payment: multiple settled payments on the same never-synced invoice are all still enqueued', () => {
    const result = computeBackfillTargets({
      payments: [
        { id: 'pay-1', invoiceId: 'inv-1', customerId: 'cust-1' },
        { id: 'pay-2', invoiceId: 'inv-1', customerId: 'cust-1' },
      ],
      invoices: [{ id: 'inv-1', customerId: 'cust-1' }],
      customers: [{ id: 'cust-1' }],
    });

    expect(result.payments.map((p) => p.id).sort()).toEqual(['pay-1', 'pay-2']);
    expect(result.invoicesToEnqueue).toEqual([]);
  });

  it('handles a brand with nothing left to sync', () => {
    const result = computeBackfillTargets({ payments: [], invoices: [], customers: [] });

    expect(result.customersToEnqueue).toEqual([]);
    expect(result.invoicesToEnqueue).toEqual([]);
    expect(result.payments).toEqual([]);
  });
});
