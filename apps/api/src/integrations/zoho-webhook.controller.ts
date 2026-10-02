import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { idSchema, type Scope } from '@sugrpay/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { ENV, type Env } from '../config/env.js';
import { CurrentScope, Public, RequirePermission } from '../tenancy/authorisation.js';
import { isValidZohoWebhookToken } from './zoho-webhook-token.js';
import {
  ZohoWebhookService,
  type PendingBrandAssignmentRow,
  type ZohoWebhookEvent,
} from './zoho-webhook.service.js';

/**
 * `event` query values accepted, onto what the service is told. Zoho's
 * workflow rules are "Created", "Edited" and "Created or Edited"; the event is
 * a static query parameter on the webhook URL (Zoho's own body is not relied
 * on for it), so the aliases are just whatever someone may plausibly have
 * typed. A missing event is fine — one URL on a "Created or Edited" rule is
 * the recommended setup, and routing does not depend on which one it was.
 */
const EVENT_ALIASES: Record<string, ZohoWebhookEvent> = {
  created: 'created',
  create: 'created',
  status_updated: 'status_updated',
  updated: 'status_updated',
  update: 'status_updated',
  edited: 'status_updated',
  created_or_edited: 'unspecified',
  created_or_updated: 'unspecified',
};

const assignBodySchema = z.object({ brandId: idSchema });

/**
 * FR-ZHO-webhook. Zoho Books signs no request the way Stripe does; the
 * mechanism it does document is per-webhook static query parameters
 * (https://www.zoho.com/books/api/v3/webhooks/), so `organization_id` and
 * `token` are configured as query parameters on the webhook URL registered in
 * Zoho (Settings > Automation > Webhooks). The exact URLs, with each
 * organization's own token filled in, are served to the admin app by
 * ZohoConnectController.webhookSetup — nobody has to assemble them by hand:
 *
 *   POST /webhooks/zoho/contacts?organization_id=…&token=…
 *   POST /webhooks/zoho/invoices?organization_id=…&token=…
 *
 * The token may also arrive as an `X-Zoho-Webhook-Token` header, for anyone
 * who would rather keep it out of the URL (Zoho supports custom headers).
 *
 * Body shape is read defensively, because Zoho's payload depends on how each
 * webhook was configured: JSON (`{"contact": {...}}` or a bare object), a
 * form post (fields, or the whole entity JSON-encoded under `JSONString`), or
 * raw JSON sent as text/plain (main.ts parses text bodies for this). Every
 * shape carries the entity's own id under contact_id/invoice_id — that id is
 * all the platform takes from the body; the record itself is always re-read
 * from Zoho's API, so nothing in a webhook body is trusted as data.
 */
@Controller('webhooks/zoho')
export class ZohoWebhookController {
  private readonly logger = new Logger(ZohoWebhookController.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly webhooks: ZohoWebhookService,
  ) {}

  @Post('contacts')
  @Public()
  @HttpCode(200)
  async contacts(
    @Query('event') event: string | undefined,
    @Query('organization_id') organizationId: string | undefined,
    @Query('token') token: string | undefined,
    @Body() body: unknown,
    @Headers('x-zoho-webhook-token') headerToken?: string,
  ): Promise<{ received: boolean }> {
    const payload = this.normalizeBody(body);
    const org = this.requireOrganizationId(organizationId, payload, 'contact');
    this.verify(org, token ?? headerToken, 'contacts');
    const parsedEvent = this.parseEvent(event);
    const contactId = this.extractId(payload, 'contact', 'contact_id');

    this.logger.log(`zoho webhook: contact ${contactId} (${parsedEvent}) from organization ${org}`);
    const result = await this.webhooks.handleContactEvent(parsedEvent, org, contactId, payload);
    if (result.status === 404) {
      // Thrown, not returned: NotFoundException is what actually sets the
      // response status to 404 — @HttpCode(200) above only governs the
      // success path.
      throw new NotFoundException('organization is not connected to any brand on this platform');
    }
    return { received: true };
  }

  @Post('invoices')
  @Public()
  @HttpCode(200)
  async invoices(
    @Query('event') event: string | undefined,
    @Query('organization_id') organizationId: string | undefined,
    @Query('token') token: string | undefined,
    @Body() body: unknown,
    @Headers('x-zoho-webhook-token') headerToken?: string,
  ): Promise<{ received: boolean }> {
    const payload = this.normalizeBody(body);
    const org = this.requireOrganizationId(organizationId, payload, 'invoice');
    this.verify(org, token ?? headerToken, 'invoices');
    const parsedEvent = this.parseEvent(event);
    const invoiceId = this.extractId(payload, 'invoice', 'invoice_id');

    this.logger.log(`zoho webhook: invoice ${invoiceId} (${parsedEvent}) from organization ${org}`);
    const result = await this.webhooks.handleInvoiceEvent(parsedEvent, org, invoiceId, payload);
    if (result.status === 404) {
      throw new NotFoundException('organization is not connected to any brand on this platform');
    }
    return { received: true };
  }

  // --- Sync Dashboard: Pending Brand Assignment queue -------------------------

  /** Merchant-wide queue (the table's RLS policy scopes by merchant only) —
   * a pending record has no brand yet, that is the whole point of it. */
  @Get('pending-assignments')
  @RequirePermission('INTEGRATIONS', 'READ', { brandFrom: 'none' })
  listPending(@CurrentScope() scope: Scope): Promise<PendingBrandAssignmentRow[]> {
    return this.webhooks.listPendingAssignments(scope);
  }

  /** The target brand travels in the body. Checked by the guard from there:
   * the pull that follows runs under a system scope for that brand, so RLS
   * would not stop a Brand Admin assigning into a brand they don't hold. */
  @Post('pending-assignments/:id/assign')
  @RequirePermission('INTEGRATIONS', 'WRITE', { brandFrom: 'body' })
  async assign(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(assignBodySchema)) body: z.infer<typeof assignBodySchema>,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    await this.webhooks.assignPendingRecord(scope, id, body.brandId);
    return { ok: true };
  }

  private verify(organizationId: string, token: string | undefined, route: string): void {
    if (!isValidZohoWebhookToken(this.env, organizationId, token)) {
      // Never logs the token itself — only whether one was present.
      this.logger.warn(
        `zoho webhook: rejected ${route} for organization ${organizationId} — ` +
          `${token ? 'token does not match this organization' : 'no token supplied'}. ` +
          `Copy the webhook URL again from Brand Settings > Integrations > Zoho Books.`,
      );
      throw new BadRequestException('invalid webhook token');
    }
  }

  private parseEvent(event: string | undefined): ZohoWebhookEvent {
    if (!event) return 'unspecified';
    const parsed = EVENT_ALIASES[event.trim().toLowerCase()];
    if (!parsed) {
      throw new BadRequestException(
        `unknown event "${event}" (expected created or status_updated, or omit it)`,
      );
    }
    return parsed;
  }

  /** Query parameter first (the documented setup); the payload's own
   * organization_id as a fallback, for a webhook whose URL left it out. */
  private requireOrganizationId(
    organizationId: string | undefined,
    payload: unknown,
    entityKey: string,
  ): string {
    const fromBody =
      this.stringField(payload, 'organization_id') ??
      this.stringField(this.entity(payload, entityKey), 'organization_id');
    const org = organizationId || fromBody;
    if (!org) throw new BadRequestException('missing organization_id');
    return org;
  }

  /** Raw-JSON text bodies and form posts carrying `JSONString` both become
   * the object they encode; anything else is passed through as-is. */
  private normalizeBody(body: unknown): unknown {
    if (typeof body === 'string') return this.tryParseJson(body) ?? body;
    if (body && typeof body === 'object') {
      const encoded = (body as Record<string, unknown>)['JSONString'];
      if (typeof encoded === 'string') return this.tryParseJson(encoded) ?? body;
    }
    return body;
  }

  private tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  private entity(body: unknown, entityKey: string): unknown {
    return body && typeof body === 'object' && entityKey in body
      ? (body as Record<string, unknown>)[entityKey]
      : body;
  }

  private stringField(record: unknown, key: string): string | undefined {
    if (!record || typeof record !== 'object') return undefined;
    const value = (record as Record<string, unknown>)[key];
    if (typeof value === 'number') return String(value);
    return typeof value === 'string' && value ? value : undefined;
  }

  private extractId(body: unknown, entityKey: string, idKey: string): string {
    const id = this.stringField(this.entity(body, entityKey), idKey);
    if (!id) {
      throw new BadRequestException(`webhook body carries no ${idKey}`);
    }
    return id;
  }
}
