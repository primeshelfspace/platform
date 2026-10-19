/**
 * AccountingPort (TDD-001 §10.2 and §10.4).
 *
 * Implemented by ZohoBooksAdapter and, for every local and test path, by
 * FakeAccounting. All writes are idempotent on the platform's own object id so
 * a retried job cannot create a duplicate contact or invoice remotely.
 */

import type { BasisPoints, CurrencyCode, Minor } from '../money/money.js';
import type { Quantity } from '../money/quantity.js';

export interface RemoteRef {
  readonly remoteId: string;
  /** Provider's own version marker, used for conflict detection. */
  readonly version?: string | null;
  readonly updatedAt?: Date | null;
}

export interface AccountingAddress {
  readonly line1: string | null;
  readonly line2: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly country: string | null;
}

export interface AccountingCustomer {
  readonly localId: string;
  readonly remoteId: string | null;
  readonly type: 'BUSINESS' | 'INDIVIDUAL';
  readonly displayName: string;
  readonly companyName: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly billingAddress: AccountingAddress | null;
  readonly shippingAddress: AccountingAddress | null;
  readonly currency: CurrencyCode;
}

export interface AccountingLineItem {
  readonly name: string;
  readonly description: string | null;
  readonly quantity: Quantity;
  readonly unitPriceMinor: Minor;
  readonly lineTotalMinor: Minor;
  readonly taxExempt: boolean;
  readonly remoteTaxId: string | null;
}

export interface AccountingInvoice {
  readonly localId: string;
  readonly remoteId: string | null;
  readonly number: string;
  readonly customerRemoteId: string;
  readonly currency: CurrencyCode;
  readonly invoiceDate: Date;
  readonly dueDate: Date;
  readonly lines: readonly AccountingLineItem[];
  readonly subtotalMinor: Minor;
  readonly taxRateBpApplied: BasisPoints;
  readonly taxMinor: Minor;
  readonly cardFeeMinor: Minor;
  readonly totalMinor: Minor;
  readonly notes: string | null;
  readonly status: 'DRAFT' | 'SENT' | 'PAID' | 'PARTIALLY_PAID' | 'VOID';
}

export interface AccountingPayment {
  readonly localId: string;
  readonly remoteId: string | null;
  readonly invoiceRemoteId: string;
  /** Zoho's Create Customer Payment requires customer_id directly — it is
   * not derivable from invoiceRemoteId without an extra round trip, so the
   * caller supplies it from the invoice's own customer relation. */
  readonly customerRemoteId: string;
  readonly amountMinor: Minor;
  readonly currency: CurrencyCode;
  readonly settledAt: Date;
  readonly method: string;
  readonly reference: string | null;
}

/** Reference data pulled from the provider: tax rates, currencies, accounts. */
export interface AccountingReferenceData {
  readonly taxRates: ReadonlyArray<{
    readonly remoteId: string;
    readonly label: string;
    readonly rateBp: BasisPoints;
    readonly active: boolean;
  }>;
  readonly currencies: readonly CurrencyCode[];
}

export interface AccountingChange {
  readonly objectType: 'CUSTOMER' | 'INVOICE' | 'PAYMENT';
  readonly remoteId: string;
  readonly changeType: 'CREATED' | 'UPDATED' | 'DELETED';
  readonly occurredAt: Date;
  readonly payload: unknown;
}

export interface PullChangesInput {
  readonly since: Date;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface PullChangesResult {
  readonly changes: readonly AccountingChange[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Every method takes a connection handle rather than reading credentials from
 * config: connections are per brand, and a worker processes brands from many
 * merchants in the same process.
 */
export interface AccountingConnection {
  readonly brandId: string;
  readonly organisationId: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date | null;
}

export interface AccountingPort {
  readonly providerName: string;

  upsertCustomer(
    connection: AccountingConnection,
    customer: AccountingCustomer,
  ): Promise<RemoteRef>;

  pushInvoice(connection: AccountingConnection, invoice: AccountingInvoice): Promise<RemoteRef>;

  pushPayment(connection: AccountingConnection, payment: AccountingPayment): Promise<RemoteRef>;

  voidInvoice(connection: AccountingConnection, remoteInvoiceId: string): Promise<void>;

  pullReferenceData(connection: AccountingConnection): Promise<AccountingReferenceData>;

  pullChanges(
    connection: AccountingConnection,
    input: PullChangesInput,
  ): Promise<PullChangesResult>;

  /** Cheap call used by the connection health check on the integrations page. */
  ping(connection: AccountingConnection): Promise<boolean>;
}

export const ACCOUNTING_PORT = Symbol('AccountingPort');
