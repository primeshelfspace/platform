import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { idSchema, type Scope } from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { ENV, type Env } from '../config/env.js';
import { CurrentScope, Public, RequirePermission } from '../tenancy/authorisation.js';
import {
  ZohoWebhookService,
  type PendingBrandAssignmentRow,
  type ZohoWebhookEvent,
} from './zoho-webhook.service.js';

const WEBHOOK_EVENTS: readonly ZohoWebhookEvent[] = ['created', 'status_updated'];

const assignBodySchema = z.object({ brandId: idSchema });

/**
 * FR-ZHO-webhook. Zoho Books signs no request the way Stripe does; the
 * mechanism it does document is per-webhook static query/form parameters
 * (https://www.zoho.com/books/api/v3/webhooks/), so `token` and
 * `organization_id` are configured as static query parameters on each
 * webhook definition registered in Zoho (Settings > Automation > Webhooks),
 * alongside `event` naming which of the two events on that entity this URL
 * represents.
 *
 * One webhook definition per (entity, event) pair is expected — four in
 * total — each pointed at:
 *   POST /webhooks/zoho/contacts?event=created&organization_id=…&token=…
 *   POST /webhooks/zoho/contacts?event=status_updated&organization_id=…&token=…
 *   POST /webhooks/zoho/invoices?event=created&organization_id=…&token=…
 *   POST /webhooks/zoho/invoices?event=status_updated&organization_id=…&token=…
 * rather than one URL fanning out multiple event types, so routing never
 * depends on parsing an event name out of Zoho's own body — Zoho's public
 * docs do not confirm that body shape, but the URL is entirely this
 * platform's own choice and is therefore reliable regardless.
 *
 * Body shape is read defensively (`body.contact ?? body`,
 * `body.invoice ?? body`) since Zoho's webhook payload is configurable
 * per-definition and not documented down to the exact field, but every
 * shape Zoho could plausibly send carries the entity's own id under
 * contact_id/invoice_id.
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
  ): Promise<{ received: boolean }> {
    this.verify(token);
    const parsedEvent = this.parseEvent(event);
    const org = this.requireOrganizationId(organizationId);
    const contactId = this.extractId(body, 'contact', 'contact_id');

    const result = await this.webhooks.handleContactEvent(parsedEvent, org, contactId, body);
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
  ): Promise<{ received: boolean }> {
    this.verify(token);
    const parsedEvent = this.parseEvent(event);
    const org = this.requireOrganizationId(organizationId);
    const invoiceId = this.extractId(body, 'invoice', 'invoice_id');

    const result = await this.webhooks.handleInvoiceEvent(parsedEvent, org, invoiceId, body);
    if (result.status === 404) {
      throw new NotFoundException('organization is not connected to any brand on this platform');
    }
    return { received: true };
  }

  // --- Sync Dashboard: Pending Brand Assignment queue -------------------------

  @Get('pending-assignments')
  @RequirePermission('INTEGRATIONS', 'READ')
  listPending(@CurrentScope() scope: Scope): Promise<PendingBrandAssignmentRow[]> {
    return this.webhooks.listPendingAssignments(scope);
  }

  @Post('pending-assignments/:id/assign')
  @RequirePermission('INTEGRATIONS', 'WRITE')
  async assign(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(assignBodySchema)) body: z.infer<typeof assignBodySchema>,
    @CurrentScope() scope: Scope,
  ): Promise<{ ok: true }> {
    await this.webhooks.assignPendingRecord(scope, id, body.brandId);
    return { ok: true };
  }

  private verify(token: string | undefined): void {
    if (!this.env.ZOHO_WEBHOOK_SECRET || token !== this.env.ZOHO_WEBHOOK_SECRET) {
      this.logger.warn('zoho webhook: rejected — missing or incorrect token');
      throw new BadRequestException('invalid webhook token');
    }
  }

  private parseEvent(event: string | undefined): ZohoWebhookEvent {
    if (!event || !WEBHOOK_EVENTS.includes(event as ZohoWebhookEvent)) {
      throw new BadRequestException(
        `unknown or missing event (expected one of ${WEBHOOK_EVENTS.join(', ')})`,
      );
    }
    return event as ZohoWebhookEvent;
  }

  private requireOrganizationId(organizationId: string | undefined): string {
    if (!organizationId) throw new BadRequestException('missing organization_id');
    return organizationId;
  }

  private extractId(body: unknown, entityKey: string, idKey: string): string {
    const record =
      body && typeof body === 'object' && entityKey in body
        ? (body as Record<string, unknown>)[entityKey]
        : body;
    const id =
      record && typeof record === 'object' ? (record as Record<string, unknown>)[idKey] : undefined;
    if (typeof id !== 'string' || !id) {
      throw new BadRequestException(`webhook body carries no ${idKey}`);
    }
    return id;
  }
}
