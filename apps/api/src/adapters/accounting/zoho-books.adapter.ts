import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IntegrationError,
  classifyHttpStatus,
  formatQuantity,
  minorUnitExponent,
  type AccountingChange,
  type AccountingConnection,
  type AccountingCustomer,
  type AccountingInvoice,
  type AccountingPayment,
  type AccountingPort,
  type AccountingReferenceData,
  type CurrencyCode,
  type PullChangesInput,
  type PullChangesResult,
  type RemoteRef,
} from '@fenwick/shared';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../infra/redis/redis.service.js';

/**
 * Zoho Books API v3's documented ceiling, per organisation. Kept a little
 * under 100 rather than at it — acquireRateToken's window is a fixed window,
 * not sliding, so a burst straddling two window boundaries could otherwise
 * momentarily see close to double the nominal limit.
 */
const ZOHO_BOOKS_RATE_LIMIT_PER_MINUTE = 90;
const RATE_LIMIT_WINDOW_SECONDS = 60;
/** How long request() will wait for a slot to free up before giving up and
 * surfacing a TRANSIENT error for the job's own retry/backoff to handle —
 * long enough to ride out one full window, never indefinite. */
const RATE_LIMIT_MAX_WAIT_MS = 65_000;
const RATE_LIMIT_POLL_MS = 300;

/**
 * Zoho's OAuth token endpoints return this shape for both grant types — and,
 * confusingly, also return HTTP 200 (not a 4xx) for a rejected request, with
 * error/error_description in place of the token fields instead. That is
 * exactly the shape toIntegrationError below exists to handle, but it only
 * ever runs off !response.ok, so a 200-with-error body slips past it and
 * needs its own error/error_description read where these fields are used.
 */
interface ZohoTokenResponse {
  access_token?: string;
  refresh_token?: string;
  api_domain?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface ZohoOrganization {
  readonly organizationId: string;
  readonly name: string;
}

interface ZohoAddressResponse {
  address?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

/** Fields present on every item in GET /contacts' list response. */
export interface ZohoContactListItem {
  contact_id: string;
  contact_name: string;
  company_name?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  last_modified_time?: string;
  /** 'active' | 'inactive' — Zoho's own archive flag. Mapped onto our
   * Customer.status by ZohoPullService rather than treated as a value to
   * merely display, so a contact deactivated in Zoho is reflected here too. */
  status?: string;
}

/**
 * A named person at a contact — billing/invoice correspondence often goes to
 * someone specific at the account, not the company's general line. Fields
 * and limits confirmed against https://www.zoho.com/books/api/v3/contact-persons/,
 * not assumed. enable_portal / is_added_in_portal / communication_preference
 * are real Zoho fields too, but govern Zoho's own client portal — deliberately
 * not carried, since this app has no equivalent of that portal.
 */
export interface ZohoContactPerson {
  contact_person_id: string;
  salutation?: string;
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  skype?: string;
  designation?: string;
  department?: string;
  is_primary_contact?: boolean;
}

/** GET /contacts/{id} only — billing/shipping address and contact_persons are
 * absent from the list response. */
export interface ZohoContactDetail extends ZohoContactListItem {
  customer_sub_type?: string;
  billing_address?: ZohoAddressResponse;
  shipping_address?: ZohoAddressResponse;
  contact_persons?: ZohoContactPerson[];
}

/** Fields present on every item in GET /invoices' list response. */
export interface ZohoInvoiceListItem {
  invoice_id: string;
  customer_id: string;
  invoice_number: string;
  status: string;
  date: string;
  due_date: string;
  currency_code: string;
  total: number;
  balance: number;
  last_modified_time?: string;
}

export interface ZohoInvoiceLineItem {
  name?: string;
  description?: string;
  rate: number;
  quantity: number;
  tax_id?: string;
}

/** GET /invoices/{id} only — line_items is absent from the list response. */
export interface ZohoInvoiceDetail extends ZohoInvoiceListItem {
  sub_total: number;
  tax_total: number;
  line_items: ZohoInvoiceLineItem[];
  notes?: string;
}

/** Fields present on every item in GET /customerpayments' list response. */
export interface ZohoPaymentListItem {
  payment_id: string;
  date: string;
  payment_mode: string;
  amount: number;
}

/** GET /customerpayments/{id} only — customer_id and invoices[] are absent
 * from the list response, per the confirmed Zoho Books API v3 docs. */
export interface ZohoPaymentDetail extends ZohoPaymentListItem {
  customer_id: string;
  reference_number?: string;
  invoices?: Array<{ invoice_id: string; amount_applied: number }>;
}

/**
 * ZohoBooksAdapter.
 *
 * OAuth refresh, request signing, rate-limit handling and the error
 * classification the sync worker's retry policy depends on (TDD-001 §11.2),
 * plus the real Contact/Invoice/Customer Payment field mappings (TDD-001
 * §10.4). Both directions are live: the pull methods below back
 * ZohoPullService, and pullChanges is a real list-level change feed.
 * voidInvoice remains the one genuine stub — see its own comment for the open
 * question blocking it.
 *
 * Used directly by ZohoSyncService rather than through ACCOUNTING_PORT: the
 * push integration always talks to Zoho specifically, regardless of which
 * adapter ACCOUNTING_DRIVER binds for the rest of the app (fake locally).
 */
@Injectable()
export class ZohoBooksAdapter implements AccountingPort {
  readonly providerName = 'zoho-books';

  private readonly logger = new Logger(ZohoBooksAdapter.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}

  // --- Transport -----------------------------------------------------------

  /**
   * Exchanges a refresh token for a new access token. Called when a request
   * returns 401 and once ahead of a known expiry.
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const url = new URL('/oauth/v2/token', this.env.ZOHO_ACCOUNTS_DOMAIN);
    url.searchParams.set('refresh_token', refreshToken);
    url.searchParams.set('client_id', this.env.ZOHO_CLIENT_ID ?? '');
    url.searchParams.set('client_secret', this.env.ZOHO_CLIENT_SECRET ?? '');
    url.searchParams.set('grant_type', 'refresh_token');

    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) {
      throw await this.toIntegrationError(response, 'token refresh');
    }

    const body = (await response.json()) as ZohoTokenResponse;
    if (!body.access_token) {
      throw new IntegrationError({
        message: 'token refresh returned no access token',
        errorClass: 'AUTHENTICATION',
        provider: this.providerName,
        providerMessage: body.error_description ?? body.error,
      });
    }
    return {
      accessToken: body.access_token,
      expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    };
  }

  /**
   * The one-time authorization-code exchange that completes the OAuth
   * connect flow. api_domain in the response is authoritative for which
   * regional endpoint (.com/.eu/.in/...) this account actually lives on —
   * that is how the data-center question gets answered without asking the
   * merchant to know it themselves.
   */
  async exchangeAuthorizationCode(
    code: string,
  ): Promise<{ accessToken: string; refreshToken: string; apiDomain: string; expiresAt: Date }> {
    const url = new URL('/oauth/v2/token', this.env.ZOHO_ACCOUNTS_DOMAIN);
    url.searchParams.set('code', code);
    url.searchParams.set('client_id', this.env.ZOHO_CLIENT_ID ?? '');
    url.searchParams.set('client_secret', this.env.ZOHO_CLIENT_SECRET ?? '');
    url.searchParams.set('redirect_uri', this.env.ZOHO_REDIRECT_URI ?? '');
    url.searchParams.set('grant_type', 'authorization_code');

    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) {
      throw await this.toIntegrationError(response, 'authorization code exchange');
    }

    const body = (await response.json()) as ZohoTokenResponse;
    if (!body.access_token || !body.refresh_token || !body.api_domain) {
      // Zoho's token endpoint answers a rejected code with HTTP 200 and an
      // error/error_description body rather than a 4xx, so the real reason
      // (invalid_code, invalid_client, a redirect_uri that doesn't match
      // what's registered for this client, ...) has to be read from here —
      // it never reaches toIntegrationError's !response.ok branch.
      const reason = body.error_description ?? body.error;
      throw new IntegrationError({
        message: reason
          ? `authorization code exchange returned an incomplete response (${reason})`
          : 'authorization code exchange returned an incomplete response',
        errorClass: 'AUTHENTICATION',
        provider: this.providerName,
        providerMessage: reason,
        providerCode: body.error,
      });
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      apiDomain: body.api_domain,
      expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    };
  }

  /**
   * Bootstrap-only call: which organizations this now-authorized account can
   * see, so the merchant picks one before any brand-scoped request (which
   * always needs an organization_id) becomes possible.
   */
  async listOrganizations(accessToken: string, apiDomain: string): Promise<ZohoOrganization[]> {
    const url = new URL('/books/v3/organizations', apiDomain);
    const response = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    if (!response.ok) {
      throw await this.toIntegrationError(response, 'GET /organizations');
    }
    const body = (await response.json()) as {
      organizations?: Array<{ organization_id: string; name: string }>;
    };
    return (body.organizations ?? []).map((org) => ({
      organizationId: org.organization_id,
      name: org.name,
    }));
  }

  /**
   * One request against the Books API, with Zoho's errors mapped onto the
   * platform's classification so the worker knows whether to retry, halt the
   * brand's stream, or dead-letter.
   */
  async request<T>(
    connection: AccountingConnection,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    await this.waitForRateSlot(connection.brandId, `${method} ${path}`);

    const url = new URL(path, this.env.ZOHO_API_DOMAIN);
    url.searchParams.set('organization_id', connection.organisationId);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${connection.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) {
      throw await this.toIntegrationError(response, `${method} ${path}`);
    }
    return (await response.json()) as T;
  }

  /**
   * Proactive throttling, not just reactive 429 handling: RedisService's
   * per-brand token bucket (built for exactly this — see its own doc
   * comment — but never actually wired to anything before this) gates every
   * Books API call so a brand's own pull, with several detail fetches now
   * running concurrently (ZohoPullService's mapWithConcurrency batches),
   * saturates Zoho's real ceiling instead of either sitting well under it
   * (the old one-call-at-a-time loop) or blowing past it into a 429/backoff
   * churn that would be slower than not throttling at all.
   *
   * Keyed by brandId, matching acquireRateToken's own design — correct as
   * long as a brand's Zoho connection maps to one Zoho organisation, which
   * is what a brand's own IntegrationConnection row records today. Two
   * brands sharing one underlying Zoho organisation would each get their own
   * budget against what is, at Zoho, actually one shared ceiling; nothing in
   * the connect flow prevents that today, so it's a real edge case, just not
   * one this change introduces.
   */
  private async waitForRateSlot(brandId: string, context: string): Promise<void> {
    const startedAt = Date.now();
    while (
      !(await this.redis.acquireRateToken(
        brandId,
        ZOHO_BOOKS_RATE_LIMIT_PER_MINUTE,
        RATE_LIMIT_WINDOW_SECONDS,
      ))
    ) {
      if (Date.now() - startedAt > RATE_LIMIT_MAX_WAIT_MS) {
        throw new IntegrationError({
          message: `Zoho Books: local rate limit still exhausted after ${RATE_LIMIT_MAX_WAIT_MS}ms waiting for ${context}`,
          errorClass: 'TRANSIENT',
          provider: this.providerName,
          retryAfterMs: RATE_LIMIT_WINDOW_SECONDS * 1000,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_POLL_MS));
    }
  }

  private async toIntegrationError(response: Response, context: string): Promise<IntegrationError> {
    const text = await response.text().catch(() => '');
    let providerMessage = text;
    let providerCode: string | undefined;
    let oauthError: string | undefined;

    try {
      const parsed = JSON.parse(text) as {
        message?: string;
        code?: number;
        error?: string;
        error_description?: string;
      };
      providerMessage = parsed.message ?? parsed.error_description ?? text;
      providerCode = parsed.code === undefined ? undefined : String(parsed.code);
      oauthError = parsed.error;
    } catch {
      // Leave the raw body as the provider message.
    }

    // Zoho signals rate limiting with 429 (with Retry-After) on the Books
    // API, but its OAuth token endpoint signals the exact same condition as
    // a plain 400 with error: "Access Denied" — classifyHttpStatus alone
    // reads any 400 as a permanent validation failure, which would mean a
    // token-refresh rate limit is treated as unretryable instead of the
    // transient condition it actually is.
    const retryAfter = response.headers.get('retry-after');
    const isOAuthRateLimit = response.status === 400 && oauthError === 'Access Denied';

    return new IntegrationError({
      message: `Zoho Books: ${context} failed with ${response.status}`,
      errorClass: isOAuthRateLimit ? 'TRANSIENT' : classifyHttpStatus(response.status),
      provider: this.providerName,
      providerMessage,
      providerCode,
      httpStatus: response.status,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
    });
  }

  async ping(connection: AccountingConnection): Promise<boolean> {
    await this.request(connection, 'GET', '/books/v3/organizations');
    return true;
  }

  async pullReferenceData(connection: AccountingConnection): Promise<AccountingReferenceData> {
    const body = await this.request<{
      taxes?: Array<{ tax_id: string; tax_name: string; tax_percentage: number; status?: string }>;
    }>(connection, 'GET', '/books/v3/settings/taxes');

    return {
      taxRates: (body.taxes ?? []).map((tax) => ({
        remoteId: tax.tax_id,
        label: tax.tax_name,
        // Percentage to basis points. Zoho returns a decimal percentage; the
        // rounding here is the only place a rate crosses from decimal to
        // integer, and it happens once, at the boundary.
        rateBp: Math.round(tax.tax_percentage * 100),
        active: tax.status !== 'inactive',
      })),
      currencies: ['USD'],
    };
  }

  // --- Object mapping (FR-ZHO, TDD-001 §10.4) -------------------------------

  /**
   * contact_name is Zoho's required display field; company_name is separate
   * and optional (confirmed against the real Create Contact reference, not
   * assumed). An individual has no company_name, so contact_name always
   * carries our displayName — that is what search and every Zoho UI list
   * shows regardless of type.
   *
   * Duplicate-match on existing email is intentionally NOT attempted here:
   * silently merging into a contact this push did not create risks attaching
   * our invoices to the wrong customer. remoteId absent means create; present
   * means update; anything else is a conflict for an operator, not a guess.
   */
  async upsertCustomer(
    connection: AccountingConnection,
    customer: AccountingCustomer,
  ): Promise<RemoteRef> {
    const payload = {
      contact_name: customer.displayName,
      company_name: customer.companyName ?? undefined,
      contact_type: 'customer',
      customer_sub_type: customer.type === 'BUSINESS' ? 'business' : 'individual',
      email: customer.email ?? undefined,
      phone: customer.phone ?? undefined,
      billing_address: customer.billingAddress
        ? this.toZohoAddress(customer.billingAddress)
        : undefined,
      shipping_address: customer.shippingAddress
        ? this.toZohoAddress(customer.shippingAddress)
        : undefined,
    };

    const body = customer.remoteId
      ? await this.request<{ contact: { contact_id: string; last_modified_time?: string } }>(
          connection,
          'PUT',
          `/books/v3/contacts/${customer.remoteId}`,
          { body: payload },
        )
      : await this.request<{ contact: { contact_id: string; last_modified_time?: string } }>(
          connection,
          'POST',
          '/books/v3/contacts',
          { body: payload },
        );

    const contactId = body.contact.contact_id;
    return {
      remoteId: contactId,
      updatedAt: await this.resolveWriteVersion(
        body.contact.last_modified_time,
        async () => (await this.getContact(connection, contactId)).last_modified_time,
        `contact ${contactId}`,
      ),
    };
  }

  /**
   * Card fee representation (the open question this method used to name) is
   * resolved as: push it as its own plain line item, always — not a Zoho
   * "fee" construct, because whether it is a merchant cost or a customer
   * surcharge is FRS-001 Q-01, still unanswered, and a line item is neutral
   * to that question either way. Same treatment for tax when the invoice
   * carries no remoteTaxId (no synced TaxRate yet): a plain line, so the
   * pushed total still reconciles exactly, rather than silently dropping it
   * because Zoho's own tax engine has nothing to reference.
   */
  async pushInvoice(
    connection: AccountingConnection,
    invoice: AccountingInvoice,
  ): Promise<RemoteRef> {
    const lineItems = invoice.lines.map((line) => ({
      name: line.name,
      description: line.description ?? undefined,
      rate: this.minorToDecimal(line.unitPriceMinor, invoice.currency),
      quantity: Number(formatQuantity(line.quantity)),
      tax_id: line.taxExempt ? undefined : (line.remoteTaxId ?? undefined),
    }));

    // No remoteTaxId anywhere on the invoice: represent the already-computed
    // tax as a visible, zero-quantity-priced line rather than a silent gap.
    if (invoice.taxMinor > 0 && invoice.lines.every((l) => !l.remoteTaxId)) {
      lineItems.push({
        name: 'Tax',
        description: `Tax at the rate applied when this invoice was issued (${(invoice.taxRateBpApplied / 100).toFixed(2)}%)`,
        rate: this.minorToDecimal(invoice.taxMinor, invoice.currency),
        quantity: 1,
        tax_id: undefined,
      });
    }
    if (invoice.cardFeeMinor > 0) {
      lineItems.push({
        name: 'Card processing fee',
        description: 'Applied because this invoice was paid by card or digital wallet',
        rate: this.minorToDecimal(invoice.cardFeeMinor, invoice.currency),
        quantity: 1,
        tax_id: undefined,
      });
    }

    const payload = {
      customer_id: invoice.customerRemoteId,
      invoice_number: invoice.number,
      date: this.toZohoDate(invoice.invoiceDate),
      due_date: this.toZohoDate(invoice.dueDate),
      line_items: lineItems,
      notes: invoice.notes ?? undefined,
    };

    const body = invoice.remoteId
      ? await this.request<{ invoice: { invoice_id: string; last_modified_time?: string } }>(
          connection,
          'PUT',
          `/books/v3/invoices/${invoice.remoteId}`,
          { body: payload },
        )
      : await this.request<{ invoice: { invoice_id: string; last_modified_time?: string } }>(
          connection,
          'POST',
          '/books/v3/invoices',
          { body: payload },
        );

    const invoiceId = body.invoice.invoice_id;
    return {
      remoteId: invoiceId,
      updatedAt: await this.resolveWriteVersion(
        body.invoice.last_modified_time,
        async () => (await this.getInvoice(connection, invoiceId)).last_modified_time,
        `invoice ${invoiceId}`,
      ),
    };
  }

  /**
   * The Zoho last_modified_time for a record we have just written, which
   * ZohoSyncService stores as zohoSyncedVersion so the next pull can tell our
   * own write apart from a genuine edit made in Zoho (see either model's own
   * comment in schema.prisma for what that prevents).
   *
   * Books v3 returns the full object on create and update, so the write
   * response normally carries this already and no extra request is made. The
   * readback is the fallback for a response that omits it: with no version at
   * all the echo check cannot engage, and the round-trip corruption it exists
   * to prevent returns silently — one cheap GET is worth more than that. A
   * readback that itself fails is not fatal; null just means the next pull
   * treats the record as changed, which is exactly the old behaviour.
   */
  private async resolveWriteVersion(
    fromWriteResponse: string | undefined,
    readBack: () => Promise<string | undefined>,
    context: string,
  ): Promise<Date | null> {
    const direct = this.parseZohoTimestamp(fromWriteResponse);
    if (direct) return direct;
    try {
      return this.parseZohoTimestamp(await readBack());
    } catch (error) {
      this.logger.warn(
        `could not read back last_modified_time for ${context} after writing it — ` +
          `the next pull will treat it as changed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * payment_mode is Zoho's fixed enum (check/cash/creditcard/banktransfer/
   * bankremittance/autotransaction/others) — our PaymentMethod values are
   * mapped onto it in mapPaymentMode below rather than passed through, since
   * the two vocabularies do not match one-for-one (WALLET has no dedicated
   * mode in Zoho and settles as creditcard for accounting purposes).
   */
  async pushPayment(
    connection: AccountingConnection,
    payment: AccountingPayment,
  ): Promise<RemoteRef> {
    const payload = {
      customer_id: payment.customerRemoteId,
      payment_mode: this.mapPaymentMode(payment.method),
      amount: this.minorToDecimal(payment.amountMinor, payment.currency),
      date: this.toZohoDate(payment.settledAt),
      reference_number: payment.reference ?? undefined,
      invoices: [
        {
          invoice_id: payment.invoiceRemoteId,
          amount_applied: this.minorToDecimal(payment.amountMinor, payment.currency),
        },
      ],
    };

    const body = await this.request<{ payment: { payment_id: string } }>(
      connection,
      'POST',
      '/books/v3/customerpayments',
      { body: payload },
    );
    return { remoteId: body.payment.payment_id };
  }

  private mapPaymentMode(method: string): string {
    switch (method) {
      case 'CARD':
      case 'WALLET':
        return 'creditcard';
      case 'ACH':
        return 'banktransfer';
      case 'CHECK':
        return 'check';
      default:
        return 'others';
    }
  }

  /**
   * The one conversion point between our integer minor units and the plain JSON
   * number Zoho's API contract requires (TDD-001 §9.1: this is the boundary,
   * never an intermediate step).
   *
   * Takes the currency rather than assuming 100. Every currency the platform
   * supports today is 2-decimal, so this is presently equivalent — the point is
   * that adding JPY or KWD to SUPPORTED_CURRENCIES stays a one-line change
   * instead of silently making every pushed amount wrong by 100x.
   */
  private minorToDecimal(minor: number, currency: CurrencyCode): number {
    const exponent = minorUnitExponent(currency);
    return Number((minor / 10 ** exponent).toFixed(exponent));
  }

  private toZohoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private parseZohoTimestamp(value: string | undefined): Date | null {
    return value ? new Date(value) : null;
  }

  private toZohoAddress(address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
  }): Record<string, string | undefined> {
    return {
      address: address.line1 ?? undefined,
      street2: address.line2 ?? undefined,
      city: address.city ?? undefined,
      state: address.region ?? undefined,
      zip: address.postalCode ?? undefined,
      country: address.country ?? undefined,
    };
  }

  voidInvoice(_connection: AccountingConnection, _remoteInvoiceId: string): Promise<void> {
    return Promise.reject(
      this.mappingPending(
        'voidInvoice',
        'whether a cancelled invoice should void or delete in Zoho',
      ),
    );
  }

  /**
   * Generic port shape (FR-ZHO-030) — kept honest and real, not a stub, by
   * delegating to the same list calls ZohoPullService uses directly for its
   * finer-grained needs. This exists for any caller that wants a uniform
   * change feed rather than per-entity detail; it is intentionally the
   * cheaper, list-level view (no per-record detail fetch), since detail
   * fetching only the records actually touched is what makes the real pull
   * path affordable against Zoho's 100-req/min limit.
   */
  async pullChanges(
    connection: AccountingConnection,
    input: PullChangesInput,
  ): Promise<PullChangesResult> {
    const sinceIso = input.since.toISOString();
    const changes: AccountingChange[] = [];

    const { contacts } = await this.listContactsPage(connection, 1);
    for (const c of contacts) {
      if (c.last_modified_time && new Date(c.last_modified_time) > input.since) {
        changes.push({
          objectType: 'CUSTOMER',
          remoteId: c.contact_id,
          changeType: 'UPDATED',
          occurredAt: new Date(c.last_modified_time),
          payload: c,
        });
      }
    }

    const { invoices } = await this.listInvoicesPage(connection, 1, sinceIso);
    for (const i of invoices) {
      changes.push({
        objectType: 'INVOICE',
        remoteId: i.invoice_id,
        changeType: 'UPDATED',
        occurredAt: i.last_modified_time ? new Date(i.last_modified_time) : new Date(),
        payload: i,
      });
    }

    return { changes, nextCursor: null, hasMore: false };
  }

  // --- Pull (FR-ZHO-030) -----------------------------------------------------
  //
  // Verified against the real Zoho Books API v3 docs, not assumed:
  //  - Invoices supports a genuine server-side "last_modified_time" filter
  //    ("modified after" semantics) — the cheap, correct incremental path.
  //  - Contacts has no modified-time *filter*, and — critically — no
  //    documented `sort_order` *input* parameter either (it only appears in
  //    the response), so a descending-sort-plus-early-stop scan cannot be
  //    relied on. This scans every page every run and filters client-side by
  //    last_modified_time instead: less efficient, but correct regardless of
  //    whatever order Zoho actually returns.
  //  - Customer Payments exposes no modified-time field anywhere, on the
  //    list or the single-record response. There is no way to ask Zoho
  //    "what changed" for payments at all — only a full scan, diffed
  //    locally by payment_id, is possible with the documented API.
  //  - line_items (Invoices) and customer_id/invoices[] (Customer Payments)
  //    are absent from their respective list responses — only the
  //    single-record GET returns them, hence the separate detail methods.

  async listContactsPage(
    connection: AccountingConnection,
    page: number,
  ): Promise<{ contacts: ZohoContactListItem[]; hasMorePage: boolean }> {
    const body = await this.request<{
      contacts?: ZohoContactListItem[];
      page_context?: { has_more_page?: boolean };
    }>(connection, 'GET', '/books/v3/contacts', {
      // Status.All: without this Zoho returns only active contacts, and a
      // customer archived (or hard-deleted, which Zoho itself only allows
      // once no invoice references them) there would never come back down
      // this list again for pullCustomers to notice and archive locally.
      query: { page: String(page), per_page: '200', filter_by: 'Status.All' },
    });
    return {
      contacts: body.contacts ?? [],
      hasMorePage: Boolean(body.page_context?.has_more_page),
    };
  }

  async getContact(
    connection: AccountingConnection,
    contactId: string,
  ): Promise<ZohoContactDetail> {
    const body = await this.request<{ contact: ZohoContactDetail }>(
      connection,
      'GET',
      `/books/v3/contacts/${contactId}`,
    );
    return body.contact;
  }

  async listInvoicesPage(
    connection: AccountingConnection,
    page: number,
    sinceIso: string | null,
  ): Promise<{ invoices: ZohoInvoiceListItem[]; hasMorePage: boolean }> {
    const query: Record<string, string> = { page: String(page), per_page: '200' };
    // Zoho rejects this filter outright ("Invalid value passed for
    // last_modified_time", a 400 that fails the whole list call, not just one
    // record) given plain ISO 8601 — no milliseconds, and a literal 'Z' or a
    // colon-separated offset ('+00:00') both get rejected too. Their parser
    // wants the numeric-offset form with no colon ('+0000'), confirmed
    // against the live API rather than assumed from docs.
    if (sinceIso) query.last_modified_time = sinceIso.replace(/\.\d{3}Z$/, '+0000');

    const body = await this.request<{
      invoices?: ZohoInvoiceListItem[];
      // The docs render this as an array in the Invoices example (unlike the
      // plain object shown for Contacts/Payments) — handled defensively
      // rather than trusted as definitely one shape or the other.
      page_context?: { has_more_page?: boolean } | Array<{ has_more_page?: boolean }>;
    }>(connection, 'GET', '/books/v3/invoices', { query });

    const pageContext = Array.isArray(body.page_context) ? body.page_context[0] : body.page_context;
    return { invoices: body.invoices ?? [], hasMorePage: Boolean(pageContext?.has_more_page) };
  }

  async getInvoice(
    connection: AccountingConnection,
    invoiceId: string,
  ): Promise<ZohoInvoiceDetail> {
    const body = await this.request<{ invoice: ZohoInvoiceDetail }>(
      connection,
      'GET',
      `/books/v3/invoices/${invoiceId}`,
    );
    return body.invoice;
  }

  async listPaymentsPage(
    connection: AccountingConnection,
    page: number,
  ): Promise<{ payments: ZohoPaymentListItem[]; hasMorePage: boolean }> {
    const body = await this.request<{
      customerpayments?: ZohoPaymentListItem[];
      page_context?: { has_more_page?: boolean };
    }>(connection, 'GET', '/books/v3/customerpayments', {
      query: { page: String(page), per_page: '200' },
    });
    return {
      payments: body.customerpayments ?? [],
      hasMorePage: Boolean(body.page_context?.has_more_page),
    };
  }

  async getPayment(
    connection: AccountingConnection,
    paymentId: string,
  ): Promise<ZohoPaymentDetail> {
    const body = await this.request<{ payment: ZohoPaymentDetail }>(
      connection,
      'GET',
      `/books/v3/customerpayments/${paymentId}`,
    );
    return body.payment;
  }

  /** Inverse of toZohoAddress — null when Zoho returned no address at all,
   * so a customer with genuinely no address on file stores null rather than
   * an object of empty strings. */
  fromZohoAddress(address: ZohoAddressResponse | undefined): {
    line1: string | null;
    line2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
  } | null {
    if (!address || Object.keys(address).length === 0) return null;
    return {
      line1: address.address ?? null,
      line2: address.street2 ?? null,
      city: address.city ?? null,
      region: address.state ?? null,
      postalCode: address.zip ?? null,
      country: address.country ?? null,
    };
  }

  /** Inverse of mapPaymentMode. Zoho's payment_mode vocabulary is wider than
   * our PaymentMethod enum, so anything without a clear counterpart (cash,
   * paypal, stripe, ...) reads as MANUAL — an offline/other record, which is
   * exactly what those modes are from our domain's perspective. */
  reverseMapPaymentMode(mode: string): 'CARD' | 'ACH' | 'CHECK' | 'MANUAL' {
    switch (mode) {
      case 'creditcard':
        return 'CARD';
      case 'banktransfer':
      case 'bankremittance':
        return 'ACH';
      case 'check':
        return 'CHECK';
      default:
        return 'MANUAL';
    }
  }

  /** Inverse of minorToDecimal — the one place a Zoho decimal amount becomes
   * our integer minor units. Currency-aware for the same reason. */
  decimalToMinor(amount: number, currency: CurrencyCode): number {
    return Math.round(amount * 10 ** minorUnitExponent(currency));
  }

  private mappingPending(operation: string, question: string): IntegrationError {
    return new IntegrationError({
      message:
        `ZohoBooksAdapter.${operation} is not implemented. Open question: ${question}. ` +
        `Transport, auth and error classification are in place; only the field mapping is outstanding.`,
      errorClass: 'PERMANENT',
      provider: this.providerName,
    });
  }
}
