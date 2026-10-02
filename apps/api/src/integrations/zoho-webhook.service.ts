import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Scope } from '@sugrpay/shared';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RedisService } from '../infra/redis/redis.service.js';
import { ZohoPullService } from './zoho-pull.service.js';
import type { ZohoConnectionConfig } from './integration-connection.service.js';

export type ZohoWebhookObjectType = 'CUSTOMER' | 'INVOICE';
/** 'unspecified' is a webhook URL with no `event` parameter — the
 * recommended single URL on a "Created or Edited" rule. Routing never depends
 * on the event; it is recorded for the delivery log only. */
export type ZohoWebhookEvent = 'created' | 'status_updated' | 'unspecified';

export interface ZohoWebhookDelivery {
  readonly at: string;
  readonly objectType: ZohoWebhookObjectType;
  readonly event: ZohoWebhookEvent;
  readonly remoteId: string;
  readonly outcome: string;
}

const DELIVERY_LOG_TTL_SECONDS = 30 * 24 * 60 * 60;

function deliveryKey(organizationId: string): string {
  return `zoho:webhook-last-delivery:${organizationId}`;
}

export interface ZohoWebhookResult {
  /** What the caller (ZohoWebhookController) should answer Zoho with. */
  readonly status: 200 | 404;
}

export interface PendingBrandAssignmentRow {
  readonly id: string;
  readonly organizationId: string;
  readonly objectType: string;
  readonly remoteId: string;
  readonly reason: string;
  readonly status: string;
  readonly payload: unknown;
  readonly createdAt: Date;
}

interface CandidateBrand {
  readonly brandId: string;
  readonly merchantId: string;
}

/**
 * FR-ZHO-webhook: inbound Zoho → platform sync.
 *
 * Deliberately thin. The two "existing record" and "new record, exactly one
 * brand" outcomes both resolve to the same action — pull this one record
 * right now — and ZohoPullService.pullOneCustomerNow/pullOneInvoiceNow
 * already implement that correctly (field mapping, echo suppression, the
 * currency/validation refusals, the SyncJob audit trail, and the
 * upsert-on-(brandId, zoho*Id) that creates the local row when it does not
 * exist yet). This service's whole job is deciding *which* brand — or that
 * none can be determined yet — never re-deriving what a pulled record's
 * fields should be.
 *
 * A platform-originated write is never ambiguous here: pushCustomer/
 * pushInvoice always operate on an already-existing local row (the row is
 * created by CustomersService/InvoicesService before the push job is even
 * enqueued), so the resulting Zoho webhook always resolves via the
 * "existing record" branch below — the multi-brand-ambiguous "new record"
 * branch can only ever be reached by a contact/invoice created directly in
 * Zoho by a human, exactly as FR-ZHO-webhook intends.
 */
@Injectable()
export class ZohoWebhookService {
  private readonly logger = new Logger(ZohoWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly zohoPull: ZohoPullService,
  ) {}

  async handleContactEvent(
    event: ZohoWebhookEvent,
    organizationId: string,
    contactId: string,
    rawPayload?: unknown,
  ): Promise<ZohoWebhookResult> {
    return this.process({
      objectType: 'CUSTOMER',
      event,
      organizationId,
      remoteId: contactId,
      rawPayload,
    });
  }

  async handleInvoiceEvent(
    event: ZohoWebhookEvent,
    organizationId: string,
    invoiceId: string,
    rawPayload?: unknown,
  ): Promise<ZohoWebhookResult> {
    return this.process({
      objectType: 'INVOICE',
      event,
      organizationId,
      remoteId: invoiceId,
      rawPayload,
    });
  }

  private async process(input: {
    objectType: ZohoWebhookObjectType;
    event: ZohoWebhookEvent;
    organizationId: string;
    remoteId: string;
    rawPayload?: unknown;
  }): Promise<ZohoWebhookResult> {
    const outcome = await this.route(input);
    await this.recordDelivery(input.organizationId, {
      at: new Date().toISOString(),
      objectType: input.objectType,
      event: input.event,
      remoteId: input.remoteId,
      outcome: outcome.description,
    });
    return { status: outcome.status };
  }

  private async route(input: {
    objectType: ZohoWebhookObjectType;
    event: ZohoWebhookEvent;
    organizationId: string;
    remoteId: string;
    rawPayload?: unknown;
  }): Promise<{ status: 200 | 404; description: string }> {
    const { objectType, organizationId, remoteId, rawPayload } = input;
    const action = objectType === 'CUSTOMER' ? 'customer' : 'invoice';

    // 1. Existing records are resolved by their stored Zoho id — never by
    // organization_id, which the record was not even tagged with at
    // creation time (FR-ZHO-webhook "Inbound — Updates to existing
    // records"). Unscoped: which brand this belongs to is exactly what this
    // lookup exists to discover. Every match, not the first: two brands
    // connected to one Zoho organization each hold their own copy of that
    // organization's contacts (and the scheduled pull imports them into
    // both), and updating only whichever row a findFirst happened to return
    // left the other brand's copy stale until its next contact scan.
    const existing = await this.findLocalRecords(objectType, remoteId);

    if (existing.length > 0) {
      let applied = 0;
      let lastFailure: string | null = null;
      for (const record of existing) {
        // Only an echo of this platform's own push is dropped here — that is
        // what ZohoSyncService marks just before calling Zoho. A redelivery of
        // a webhook already applied is not guarded separately: the pull's own
        // last_modified_time check makes it a no-op, while a post-apply guard
        // also dropped a genuine second edit made in Zoho within its window.
        if (await this.redis.hasSyncAction(record.brandId, record.id, action)) {
          this.logger.debug(
            `dropping echo of own push for ${objectType} ${record.id} (brand ${record.brandId})`,
          );
          continue;
        }
        const failure = await this.pull(objectType, record.brandId, remoteId);
        if (failure) lastFailure = failure;
        else applied++;
      }
      let description: string;
      if (lastFailure) description = `failed — ${lastFailure}`;
      else if (applied > 0) description = `updated in ${applied} brand${applied === 1 ? '' : 's'}`;
      else description = 'ignored — echo of a change this platform just pushed';
      return { status: 200, description };
    }

    // 2. Not on this platform yet — whether Zoho called it a creation or an
    // edit. An edit to a record never imported (it predates the connection,
    // or the webhook was registered after it was created) used to be parked
    // as an ORPHANED_UPDATE that nothing could resolve, while the very next
    // scheduled contact scan imported the same record anyway. Routing it the
    // same way as a creation reaches that outcome immediately instead.
    // organization_id participates in routing only here.
    const candidates = await this.candidateBrands(organizationId);
    if (candidates.length === 0) {
      this.logger.error(
        `zoho webhook: organization ${organizationId} is not connected to any brand on this ` +
          `platform — Connection Health issue (${objectType} ${remoteId})`,
      );
      return { status: 404, description: 'rejected — organization not connected to any brand' };
    }
    if (candidates.length === 1) {
      const brandId = candidates[0]!.brandId;
      // Keyed by the Zoho remote id, not a local id — none exists yet for a
      // record created natively in Zoho. Guards a redelivery of the same
      // creation against importing (and calling Zoho for) it twice while the
      // first import is still in flight.
      if (await this.redis.hasSyncAction(brandId, remoteId, action)) {
        this.logger.debug(
          `dropping duplicate Zoho webhook for new ${objectType} ${remoteId} (brand ${brandId})`,
        );
        return { status: 200, description: 'ignored — duplicate delivery' };
      }
      await this.redis.markSyncAction(brandId, remoteId, action);
      const failure = await this.pull(objectType, brandId, remoteId);
      return {
        status: 200,
        description: failure ? `failed — ${failure}` : 'imported as a new record',
      };
    }
    // Multiple brands share this organization — never guess.
    await this.recordForManualReview(
      objectType,
      organizationId,
      remoteId,
      'NEW_RECORD_MULTI_BRAND',
      candidates,
      rawPayload,
    );
    return {
      status: 200,
      description: `queued for brand assignment — organization is shared by ${candidates.length} brands`,
    };
  }

  /**
   * Runs the targeted pull, returning why it failed rather than throwing.
   * Answered 200 either way: the scheduled pull is the safety net for
   * anything a webhook could not apply, and a 5xx would only have Zoho
   * redeliver into the same failure (a deleted record, a revoked token). The
   * failure is still visible — in the SyncJob the pull recorded, the delivery
   * log, and the server log.
   */
  private async pull(
    objectType: ZohoWebhookObjectType,
    brandId: string,
    remoteId: string,
  ): Promise<string | null> {
    try {
      if (objectType === 'CUSTOMER') {
        await this.zohoPull.pullOneCustomerNow(brandId, remoteId);
      } else {
        await this.zohoPull.pullOneInvoiceNow(brandId, remoteId);
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `zoho webhook: could not pull ${objectType} ${remoteId} for brand ${brandId}: ${message}`,
      );
      return message.slice(0, 300);
    }
  }

  // --- Delivery log -----------------------------------------------------------

  /** Last accepted delivery per organization, shown on the Zoho integration
   * panel so "is Zoho actually calling us?" can be answered without server
   * logs. Only authenticated deliveries reach the service, so this cannot be
   * written by an arbitrary caller. Non-fatal by design. */
  private async recordDelivery(organizationId: string, entry: ZohoWebhookDelivery): Promise<void> {
    await this.redis
      .setJson(deliveryKey(organizationId), entry, DELIVERY_LOG_TTL_SECONDS)
      .catch((error: unknown) => {
        this.logger.warn(
          `could not record zoho webhook delivery: ${error instanceof Error ? error.message : error}`,
        );
      });
  }

  async lastDelivery(organizationId: string): Promise<ZohoWebhookDelivery | null> {
    return (await this.redis.getJson<ZohoWebhookDelivery>(deliveryKey(organizationId))) ?? null;
  }

  private async findLocalRecords(
    objectType: ZohoWebhookObjectType,
    remoteId: string,
  ): Promise<Array<{ id: string; brandId: string }>> {
    return this.prisma.withoutScope(
      `zoho webhook: resolving ${objectType.toLowerCase()} ${remoteId} by its stored Zoho id`,
      (client) =>
        objectType === 'CUSTOMER'
          ? client.customer.findMany({
              where: { zohoContactId: remoteId },
              select: { id: true, brandId: true },
            })
          : client.invoice.findMany({
              where: { zohoInvoiceId: remoteId },
              select: { id: true, brandId: true },
            }),
    );
  }

  /** Every brand whose IntegrationConnection.config.organizationId matches —
   * unscoped because which brand(s) this belongs to is exactly what routing
   * needs to discover. Organization ids are not indexed (config is opaque
   * Json, and the brand count sharing one Zoho org is always small), so this
   * is a full scan of connected Zoho connections, not a hot path. */
  private async candidateBrands(organizationId: string): Promise<CandidateBrand[]> {
    const rows = await this.prisma.withoutScope(
      `zoho webhook: resolving which brand(s) organization ${organizationId} belongs to`,
      (client) =>
        client.integrationConnection.findMany({
          where: { provider: 'ZOHO_BOOKS', status: 'CONNECTED' },
          select: { brandId: true, config: true, brand: { select: { merchantId: true } } },
        }),
    );
    return rows
      .filter(
        (row) => (row.config as ZohoConnectionConfig | null)?.organizationId === organizationId,
      )
      .map((row) => ({ brandId: row.brandId, merchantId: row.brand.merchantId }));
  }

  private async recordForManualReview(
    objectType: ZohoWebhookObjectType,
    organizationId: string,
    remoteId: string,
    reason: 'NEW_RECORD_MULTI_BRAND' | 'ORPHANED_UPDATE',
    candidates?: CandidateBrand[],
    rawPayload?: unknown,
  ): Promise<void> {
    this.logger.warn(
      `zoho webhook: ${objectType} ${remoteId} (organization ${organizationId}) needs manual ` +
        `review — ${reason}`,
    );
    const known = candidates ?? (await this.candidateBrands(organizationId));
    const merchantId = known[0]?.merchantId;
    // No brand on this platform has ever connected this organization at all
    // — there is no merchant to attribute the row to, so it is logged above
    // only. This differs from the CREATE/unknown-org case (which answers
    // 404): an update carries no full record body to route or hold either
    // way, so there is nothing further to do than log it.
    if (!merchantId) return;

    await this.prisma.withoutScope(
      `zoho webhook: recording ${reason} for manual review`,
      (client) =>
        client.pendingBrandAssignment.upsert({
          where: {
            provider_organizationId_objectType_remoteId: {
              provider: 'ZOHO_BOOKS',
              organizationId,
              objectType,
              remoteId,
            },
          },
          create: {
            merchantId,
            provider: 'ZOHO_BOOKS',
            organizationId,
            objectType,
            remoteId,
            reason,
            status: 'PENDING',
            payload: rawPayload as Prisma.InputJsonValue | undefined,
          },
          // A redelivery of the same never-resolved event refreshes the row
          // (including the payload, in case a later delivery carries more
          // fields than the first) rather than creating a duplicate — see
          // the unique constraint's own comment in schema.prisma.
          update: {
            reason,
            status: 'PENDING',
            payload: rawPayload as Prisma.InputJsonValue | undefined,
          },
        }),
    );
  }

  // --- Sync Dashboard surface -------------------------------------------------

  async listPendingAssignments(scope: Scope): Promise<PendingBrandAssignmentRow[]> {
    return this.prisma.withScope(scope, (tx) =>
      tx.pendingBrandAssignment.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Assigns a NEW_RECORD_MULTI_BRAND row to one of the brands that were
   * actually candidates for it — never an arbitrary brand id, which would
   * let an operator attach a Zoho contact/invoice to a brand not even
   * connected to the organization it came from. An ORPHANED_UPDATE row
   * cannot be assigned this way: an update carries no full record body to
   * create a local row from, so resolving one is a manual, out-of-band fix
   * (correct the data in Zoho, or wait for its own creation event).
   */
  async assignPendingRecord(scope: Scope, pendingId: string, brandId: string): Promise<void> {
    const pending = await this.prisma.withScope(scope, (tx) =>
      tx.pendingBrandAssignment.findUnique({ where: { id: pendingId } }),
    );
    if (!pending || pending.status !== 'PENDING') {
      throw new NotFoundException('pending assignment not found');
    }
    if (pending.reason !== 'NEW_RECORD_MULTI_BRAND') {
      throw new BadRequestException('only a new-record assignment can be resolved this way');
    }

    const candidates = await this.candidateBrands(pending.organizationId);
    if (!candidates.some((c) => c.brandId === brandId)) {
      throw new BadRequestException('that brand is not connected to this Zoho organization');
    }

    if (pending.objectType === 'CUSTOMER') {
      await this.zohoPull.pullOneCustomerNow(brandId, pending.remoteId);
    } else {
      await this.zohoPull.pullOneInvoiceNow(brandId, pending.remoteId);
    }

    await this.prisma.withScope(scope, (tx) =>
      tx.pendingBrandAssignment.update({
        where: { id: pendingId },
        data: { status: 'ASSIGNED', assignedBrandId: brandId, assignedAt: new Date() },
      }),
    );
  }
}
