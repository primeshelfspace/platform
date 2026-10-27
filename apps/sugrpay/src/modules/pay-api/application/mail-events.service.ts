import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { MAIL_PORT, type MailPort, type PublicScope } from '@platform/kernel';
import { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';

/**
 * The receiving half of invoice-email delivery tracking (TDD-001 §10.2): a
 * mail provider's delivery/bounce/complaint callback, correlated back to the
 * invoice it concerns and recorded so the merchant can see it.
 *
 * The provider's event carries only whatever id it assigned the message —
 * never a brand, invoice, or tenant of ours — so resolution is unscoped by
 * necessity, the same shape PaymentsService.handleWebhook uses for a
 * payment-gateway event: find the tenant from an opaque provider reference
 * first, then do the actual write inside that tenant's own scope.
 *
 * Signed with MAIL_WEBHOOK_SECRET (see SmtpMailAdapter.verifySignature). Gmail
 * and plain SMTP relays never call this; a provider that reports deliveries
 * (SES, Postmark, …) is pointed here through a small forwarder that signs
 * events in this format — see docs/integrations/mail-delivery.md.
 */
@Injectable()
export class MailEventsService {
  private readonly logger = new Logger(MailEventsService.name);

  constructor(
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    private readonly prisma: InvoicingPrismaService,
  ) {}

  async handleWebhook(rawBody: Buffer, headers: Readonly<Record<string, string>>): Promise<void> {
    if (!this.mail.verifySignature(rawBody, headers)) {
      throw new BadRequestException('invalid mail webhook signature');
    }
    const event = this.mail.parseDeliveryEvent(rawBody);

    // UNKNOWN covers every event type this platform does not model — a
    // no-op, not an error, the same treatment PaymentsService.handleWebhook
    // gives an unmodelled gateway event. A message id is required to route.
    if (event.type === 'UNKNOWN' || !event.providerMessageId) {
      this.logger.debug(
        `ignoring unmodelled mail event for ${event.providerMessageId || '(none)'}`,
      );
      return;
    }

    // Resolution by providerMessageId is unscoped on purpose — see the class
    // comment. The SENT rows written at send time (InvoicesService.sendEmail,
    // one per accepted recipient) carry the tenant this event belongs to.
    const sent = await this.prisma.withoutScope(
      'mail webhook resolution by providerMessageId — the tenant this event belongs to is not yet known',
      (client) =>
        client.mailDeliveryEvent.findFirst({
          where: { providerMessageId: event.providerMessageId, eventType: 'SENT' },
          include: { brand: { select: { merchantId: true } } },
        }),
    );
    if (!sent) {
      this.logger.warn(
        `mail webhook for unknown providerMessageId ${event.providerMessageId} — no send recorded it`,
      );
      return;
    }

    const scope: PublicScope = {
      kind: 'PUBLIC',
      merchantId: sent.brand.merchantId,
      brandId: sent.brandId,
      invoiceId: sent.invoiceId,
      sourceIp: null,
    };
    const recipient = event.recipient || sent.recipient;
    const eventType = event.type; // already known not to be UNKNOWN (checked above)

    await this.prisma.withScope(scope, async (tx) => {
      // skipDuplicates (INSERT … ON CONFLICT DO NOTHING): a provider
      // redelivering an event it already sent is the expected case the
      // unique (message, event, recipient) index exists for. count 0 means it
      // was already recorded — and its timeline entry with it.
      const { count } = await tx.mailDeliveryEvent.createMany({
        data: [
          {
            invoiceId: sent.invoiceId,
            brandId: sent.brandId,
            providerMessageId: event.providerMessageId,
            eventType,
            recipient,
            bounceKind: event.bounceKind ?? null,
            detail: event.detail ?? null,
            occurredAt: event.occurredAt,
          },
        ],
        skipDuplicates: true,
      });
      if (count === 0) {
        this.logger.debug(`duplicate mail event ignored: ${event.providerMessageId} ${event.type}`);
        return;
      }

      // Only the actionable outcomes join the invoice's own timeline — a
      // merchant needs to see a bounce or a spam complaint the way they see
      // any other event that needs their attention; DELIVERED/OPENED/CLICKED/
      // DEFERRED are kept in mail_delivery_event for status purposes but would
      // just be noise on the timeline.
      if (event.type === 'BOUNCED' || event.type === 'COMPLAINED') {
        await tx.invoiceEvent.create({
          data: {
            invoiceId: sent.invoiceId,
            eventType: event.type === 'BOUNCED' ? 'EMAIL_BOUNCED' : 'EMAIL_COMPLAINED',
            actor: 'system',
            payload: {
              recipient,
              ...(event.bounceKind ? { bounceKind: event.bounceKind } : {}),
              ...(event.detail ? { detail: event.detail } : {}),
            },
          },
        });
      }
    });
  }
}
