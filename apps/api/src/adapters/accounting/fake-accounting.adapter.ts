import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  IntegrationError,
  type AccountingChange,
  type AccountingConnection,
  type AccountingCustomer,
  type AccountingInvoice,
  type AccountingPayment,
  type AccountingPort,
  type AccountingReferenceData,
  type PullChangesInput,
  type PullChangesResult,
  type RemoteRef,
} from '@sugrpay/shared';

/**
 * FakeAccounting — in-memory AccountingPort for local development and tests
 * (TER-001 §3.2).
 *
 * It does what the real provider does that actually matters to us: assigns
 * remote ids, versions records, and refuses a write whose version is stale so
 * the conflict path has something real to exercise. Latency, conflict and error
 * injection are configurable so the sync engine's retry, conflict and
 * dead-letter branches can all be tested deterministically.
 */
interface Record_ {
  remoteId: string;
  version: number;
  updatedAt: Date;
  payload: unknown;
}

export interface FakeAccountingFaults {
  /** Milliseconds of artificial latency on every call. */
  latencyMs: number;
  /** Fail the next N calls with this class before succeeding. */
  failNext: {
    count: number;
    errorClass: 'TRANSIENT' | 'AUTHENTICATION' | 'VALIDATION' | 'PERMANENT';
  } | null;
  /** Treat the next write as a remote-side conflict. */
  conflictNextWrite: boolean;
}

@Injectable()
export class FakeAccountingAdapter implements AccountingPort {
  readonly providerName = 'fake-accounting';

  private readonly logger = new Logger(FakeAccountingAdapter.name);
  private readonly customers = new Map<string, Record_>();
  private readonly invoices = new Map<string, Record_>();
  private readonly payments = new Map<string, Record_>();
  private readonly changes: AccountingChange[] = [];

  private faults: FakeAccountingFaults = {
    latencyMs: 0,
    failNext: null,
    conflictNextWrite: false,
  };

  private clock: () => Date = () => new Date();

  setClock(clock: () => Date): void {
    this.clock = clock;
  }

  injectFaults(faults: Partial<FakeAccountingFaults>): void {
    this.faults = { ...this.faults, ...faults };
  }

  reset(): void {
    this.customers.clear();
    this.invoices.clear();
    this.payments.clear();
    this.changes.length = 0;
    this.faults = { latencyMs: 0, failNext: null, conflictNextWrite: false };
  }

  async upsertCustomer(
    connection: AccountingConnection,
    customer: AccountingCustomer,
  ): Promise<RemoteRef> {
    await this.gate(connection);
    return this.upsert(this.customers, 'CUSTOMER', customer.localId, customer.remoteId, customer);
  }

  async pushInvoice(
    connection: AccountingConnection,
    invoice: AccountingInvoice,
  ): Promise<RemoteRef> {
    await this.gate(connection);
    if (!invoice.customerRemoteId) {
      throw new IntegrationError({
        message: 'invoice references a customer that has not been synced',
        errorClass: 'VALIDATION',
        provider: this.providerName,
        providerMessage: 'customer_id is required',
      });
    }
    return this.upsert(this.invoices, 'INVOICE', invoice.localId, invoice.remoteId, invoice);
  }

  async pushPayment(
    connection: AccountingConnection,
    payment: AccountingPayment,
  ): Promise<RemoteRef> {
    await this.gate(connection);
    return this.upsert(this.payments, 'PAYMENT', payment.localId, payment.remoteId, payment);
  }

  async voidInvoice(connection: AccountingConnection, remoteInvoiceId: string): Promise<void> {
    await this.gate(connection);
    const found = [...this.invoices.entries()].find(([, r]) => r.remoteId === remoteInvoiceId);
    if (!found) {
      throw new IntegrationError({
        message: `remote invoice ${remoteInvoiceId} does not exist`,
        errorClass: 'PERMANENT',
        provider: this.providerName,
        httpStatus: 404,
      });
    }
    const [key, record] = found;
    this.invoices.set(key, {
      ...record,
      version: record.version + 1,
      updatedAt: this.clock(),
      payload: { ...(record.payload as object), status: 'VOID' },
    });
  }

  async pullReferenceData(connection: AccountingConnection): Promise<AccountingReferenceData> {
    await this.gate(connection);
    return {
      taxRates: [
        { remoteId: 'fake_tax_none', label: 'No tax', rateBp: 0, active: true },
        { remoteId: 'fake_tax_600', label: 'Sales tax 6%', rateBp: 600, active: true },
        { remoteId: 'fake_tax_875', label: 'Sales tax 8.75%', rateBp: 875, active: true },
        { remoteId: 'fake_tax_legacy', label: 'Legacy 5%', rateBp: 500, active: false },
      ],
      currencies: ['USD', 'CAD'],
    };
  }

  async pullChanges(
    connection: AccountingConnection,
    input: PullChangesInput,
  ): Promise<PullChangesResult> {
    await this.gate(connection);
    const limit = input.limit ?? 50;
    const offset = input.cursor ? Number(input.cursor) : 0;
    const eligible = this.changes.filter((c) => c.occurredAt > input.since);
    const page = eligible.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      changes: page,
      nextCursor: nextOffset < eligible.length ? String(nextOffset) : null,
      hasMore: nextOffset < eligible.length,
    };
  }

  async ping(connection: AccountingConnection): Promise<boolean> {
    await this.gate(connection);
    return true;
  }

  // --- internals -----------------------------------------------------------

  private upsert(
    store: Map<string, Record_>,
    objectType: AccountingChange['objectType'],
    localId: string,
    remoteId: string | null,
    payload: unknown,
  ): RemoteRef {
    const existing = store.get(localId);

    if (this.faults.conflictNextWrite && existing) {
      this.faults.conflictNextWrite = false;
      throw new IntegrationError({
        message: 'the record changed remotely since the last sync',
        errorClass: 'CONFLICT',
        provider: this.providerName,
        providerMessage: 'Record has been modified by another user',
        httpStatus: 409,
      });
    }

    // Idempotent on our own local id: a retried job updates rather than
    // duplicating, which is the property the real adapter must also hold.
    const record: Record_ = {
      remoteId:
        existing?.remoteId ??
        remoteId ??
        `fake_${objectType.toLowerCase()}_${randomUUID().slice(0, 8)}`,
      version: (existing?.version ?? 0) + 1,
      updatedAt: this.clock(),
      payload,
    };
    store.set(localId, record);

    this.changes.push({
      objectType,
      remoteId: record.remoteId,
      changeType: existing ? 'UPDATED' : 'CREATED',
      occurredAt: record.updatedAt,
      payload,
    });

    return {
      remoteId: record.remoteId,
      version: String(record.version),
      updatedAt: record.updatedAt,
    };
  }

  private async gate(connection: AccountingConnection): Promise<void> {
    if (this.faults.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.faults.latencyMs));
    }

    if (this.faults.failNext && this.faults.failNext.count > 0) {
      const { errorClass } = this.faults.failNext;
      this.faults.failNext = { errorClass, count: this.faults.failNext.count - 1 };
      throw new IntegrationError({
        message: `injected ${errorClass} failure`,
        errorClass,
        provider: this.providerName,
        providerMessage: `Simulated ${errorClass.toLowerCase()} failure`,
      });
    }

    if (!connection.accessToken) {
      throw new IntegrationError({
        message: 'connection has no access token',
        errorClass: 'AUTHENTICATION',
        provider: this.providerName,
        httpStatus: 401,
      });
    }

    if (connection.expiresAt && connection.expiresAt.getTime() <= this.clock().getTime()) {
      throw new IntegrationError({
        message: 'access token expired',
        errorClass: 'AUTHENTICATION',
        provider: this.providerName,
        httpStatus: 401,
      });
    }
  }
}
