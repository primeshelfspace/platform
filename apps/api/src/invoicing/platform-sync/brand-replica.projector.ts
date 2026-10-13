import { Injectable, type OnModuleInit } from '@nestjs/common';
import { EventBus, type DeliveredEvent } from '../../infra/events/event-bus.js';
import { PLATFORM_EVENTS, type BrandEventPayload } from '../../platform/public-api.js';
import { InvoicingPrismaService } from '../database/invoicing-prisma.service.js';
import { applyBrandSnapshot } from './brand-replica.js';

/**
 * Keeps invoicing's read-only `brand` table in step with the platform's brands
 * — the "copy what you need" rule. Invoicing joins to, renders, and scopes
 * row-level security by this copy, and never queries the platform's database.
 *
 * Idempotent and order-tolerant, because outbox delivery is at-least-once and
 * retries can reorder events: an event id already in processed_event is
 * skipped, and a snapshot older than the stored one is not applied (see
 * applyBrandSnapshot).
 */
@Injectable()
export class BrandReplicaProjector implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly prisma: InvoicingPrismaService,
  ) {}

  onModuleInit(): void {
    for (const topic of [PLATFORM_EVENTS.brandCreated, PLATFORM_EVENTS.brandUpdated]) {
      this.bus.subscribe<BrandEventPayload>(topic, 'invoicing.brand-replica', (event) =>
        this.handle(event),
      );
    }
  }

  async handle(event: DeliveredEvent<BrandEventPayload>): Promise<void> {
    // Owner connection: invoicing_app holds SELECT only on the brand copy,
    // and processed_event is owner-only bookkeeping.
    await this.prisma.ownerClient.$transaction(async (tx) => {
      const seen = await tx.processedEvent.findUnique({ where: { eventId: event.id } });
      if (seen) return;
      await applyBrandSnapshot(tx, event.payload.brand);
      await tx.processedEvent.create({ data: { eventId: event.id, topic: event.topic } });
    });
  }
}
