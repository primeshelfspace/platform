import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { MAIL_PORT, type MailPort, type PublicScope } from '@platform/kernel';
import { Prisma } from '../../database/client.js';
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
 */
@Injectable()
export class MailEventsService {
  private readonly logger = new Logger(MailEventsService.name);

  constructor(
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    private readonly prisma: InvoicingPrismaService,
  ) {}

  async handleWebhook(
    rawBody: Buffer,
    headers: Readonly<Record<string, string>>,
  ): Promise<void> {
    if (!this.mail.verifySignature(rawBody, headers)) {
      throw new BadRequestException('invalid mail webhook signature');
    }
    const event = this.mail.parseDeliveryEvent(rawBody);

    // UNKNOWN covers every event type this platform does not model yet
    // (opens/clicks from a provider that does not distinguish them the way
    // MAIL_EVENT_TYPES does, etc.) — a no-op, not an error, the same
    // treatment PaymentsService.handleWebhook gives an unmodelled gateway
    // event type.
    if (event.type === 'UNKNOWN') {
      this.logger.debug(`ignoring unmodelled mail event for ${event.providerMessageId}`);
      return;
    }

    // Resolution by providerMessageId is unscoped on purpose — see class
    // comment. The "SENT" row written at send time (InvoicesService.sendEmail)
    // is what carries the tenant this event belongs to.
    const sent = await this.prisma.withoutScope(
      'mail webhook resolution by providerMessageId — the tenant this event belongs to is not yet known',
      (client) =>
        client.mailDeliveryEvent.findFirst({
          where: { providerMessageId: event.providerMessageId, eventType: 'SENT' },
          include: { invoice: { select: { brand: { select: { merchantId: true } } } } },
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
      merchantId: sent.invoice.brand.merchantId,
      brandId: sent.brandId,
      invoiceId: sent.invoiceId,
      sourceIp: null,
    };

    await this.prisma.withScope(scope, async (tx) => {
      try {
        await tx.mailDeliveryEvent.create({
          data: {
            invoiceId: sent.invoiceId,
            brandId: sent.brandId,
            providerMessageId: event.providerMessageId,
            eventType: event.type,
            recipient: event.recipient,
            bounceKind: event.bounceKind ?? null,
            detail: event.detail ?? null,
            occurredAt: event.occurredAt,
            raw: isJsonCompatible(event.raw) ? event.raw : Prisma.JsonNull,
          },
        });
      } catch (error) {
        // The provider redelivering an event it already sent (its own retry
        // on a slow 200, or a merchant replaying a webhook for debugging) is
        // the expected case this constraint exists for, not a real failure —
        // the first delivery already recorded it. No target field name
        // passed: (providerMessageId, eventType) is the table's only unique
        // constraint, so any P2002 here is unambiguous — and Postgres does
        // not always hand Prisma the violated column names for a hand-written
        // migration's index the way it does for one Prisma generated itself.
        if (InvoicingPrismaService.isUniqueViolation(error)) {
          this.logger.debug(
            `duplicate mail event ignored: ${event.providerMessageId} ${event.type}`,
          );
          return;
        }
        throw error;
      }

      // Only the actionable outcomes join the invoice's own timeline — a
      // merchant needs to see a bounce or a spam complaint the way they see
      // any other event that needs their attention; DELIVERED/OPENED/CLICKED/
      // DEFERRED are tracked in mail_delivery_event for status purposes but
      // would just be noise on the timeline.
      if (event.type === 'BOUNCED' || event.type === 'COMPLAINED') {
        await tx.invoiceEvent.create({
          data: {
            invoiceId: sent.invoiceId,
            eventType: event.type === 'BOUNCED' ? 'EMAIL_BOUNCED' : 'EMAIL_COMPLAINED',
            actor: 'system',
            payload: {
              recipient: event.recipient,
              ...(event.bounceKind ? { bounceKind: event.bounceKind } : {}),
              ...(event.detail ? { detail: event.detail } : {}),
            },
          },
        });
      }
    });
  }
}

/** `MailDeliveryEvent.raw` is a Prisma `Json?` column — reject anything
 * `JSON.stringify` cannot round-trip (a Buffer, a circular object) rather
 * than let Prisma throw on the insert; the event's own typed fields are
 * already recorded either way. */
function isJsonCompatible(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}
