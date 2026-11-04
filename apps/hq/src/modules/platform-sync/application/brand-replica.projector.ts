import { Injectable, type OnModuleInit } from '@nestjs/common';
import { EventBus, type DeliveredEvent } from '@platform/server';
import { PLATFORM_EVENTS, type BrandEventPayload } from '@platform/platform-contracts';
import { HqPrismaService } from '../../database/hq-prisma.service.js';
import { applyBrandSnapshot } from '../infrastructure/brand-replica.js';

/**
 * Keeps HQ's read-only `brand` table in step with the platform's brands — the
 * "copy what you need" rule, as Sugrpay does. HQ joins to and scopes
 * row-level security by this copy, and never queries the platform's database.
 *
 * Idempotent and order-tolerant (at-least-once delivery): an event id already
 * in processed_event is skipped, and an older snapshot is not applied.
 */
@Injectable()
export class BrandReplicaProjector implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly prisma: HqPrismaService,
  ) {}

  onModuleInit(): void {
    for (const topic of [PLATFORM_EVENTS.brandCreated, PLATFORM_EVENTS.brandUpdated]) {
      this.bus.subscribe<BrandEventPayload>(topic, 'hq.brand-replica', (event) =>
        this.handle(event),
      );
    }
  }

  async handle(event: DeliveredEvent<BrandEventPayload>): Promise<void> {
    // Owner connection: hq_app holds SELECT only on the brand copy, and
    // processed_event is owner-only bookkeeping.
    await this.prisma.ownerClient.$transaction(async (tx) => {
      const seen = await tx.processedEvent.findUnique({ where: { eventId: event.id } });
      if (seen) return;
      await applyBrandSnapshot(tx, event.payload.brand);
      await tx.processedEvent.create({ data: { eventId: event.id, topic: event.topic } });
    });
  }
}
