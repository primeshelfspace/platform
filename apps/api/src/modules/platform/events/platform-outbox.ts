import { Injectable, Logger } from '@nestjs/common';
import type { DeliveredEvent } from '../../../shared/infra/events/event-bus.js';
import {
  OutboxDispatcher,
  retryDelayMs,
  type OutboxSource,
} from '../../../shared/infra/events/outbox-dispatcher.js';
import type { Brand, Prisma } from '../database/client.js';
import { toBrandSnapshot } from './brand-snapshot.js';
import { PlatformPrismaService, type ScopedClient } from '../database/platform-prisma.service.js';
import { PLATFORM_EVENTS, type BrandEventPayload, type PlatformEventTopic } from './contracts.js';

interface OutboxRow {
  id: string;
  topic: string;
  aggregate_id: string;
  payload: unknown;
  occurred_at: Date;
  attempts: number;
}

/**
 * The platform's transactional outbox.
 *
 * `record` is called INSIDE the same scoped transaction as the change it
 * announces, so the event is committed (or rolled back) with it. After the
 * transaction commits the caller awaits `flush()` so subscribers see the
 * change straight away; if that fails, the dispatcher's poll retries.
 */
@Injectable()
export class PlatformOutbox implements OutboxSource {
  readonly name = 'platform';
  private readonly logger = new Logger(PlatformOutbox.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly dispatcher: OutboxDispatcher,
  ) {
    dispatcher.register(this);
  }

  async record(
    tx: ScopedClient,
    topic: PlatformEventTopic,
    aggregateId: string,
    payload: object,
  ): Promise<void> {
    // createMany, not create: create reads the inserted row back (INSERT ...
    // RETURNING), and the application role deliberately holds INSERT only.
    await tx.outboxEvent.createMany({
      data: [{ topic, aggregateId, payload: payload as Prisma.InputJsonValue }],
    });
  }

  /** Records brand.created / brand.updated with the complete brand. */
  recordBrand(tx: ScopedClient, kind: 'created' | 'updated', brand: Brand): Promise<void> {
    const payload: BrandEventPayload = { brand: toBrandSnapshot(brand) };
    const topic = kind === 'created' ? PLATFORM_EVENTS.brandCreated : PLATFORM_EVENTS.brandUpdated;
    return this.record(tx, topic, brand.id, payload);
  }

  /**
   * Delivers what was just committed. Never throws: the change itself has
   * already succeeded, and the poll retries anything that did not go out.
   */
  async flush(): Promise<void> {
    try {
      await this.dispatcher.flush();
    } catch (error) {
      this.logger.warn(
        `event delivery deferred to the next poll: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async drain(limit: number, deliver: (event: DeliveredEvent) => Promise<void>): Promise<number> {
    return this.prisma.ownerClient.$transaction(
      async (tx) => {
        // SKIP LOCKED: another process delivering concurrently simply takes
        // different rows instead of waiting on these.
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, topic, aggregate_id, payload, occurred_at, attempts
          FROM outbox_event
          WHERE delivered_at IS NULL AND available_at <= now()
          ORDER BY occurred_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        `;
        for (const row of rows) {
          try {
            await deliver({
              id: row.id,
              topic: row.topic,
              aggregateId: row.aggregate_id,
              occurredAt: row.occurred_at,
              payload: row.payload,
            });
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { deliveredAt: new Date(), attempts: row.attempts + 1, lastError: null },
            });
          } catch (error) {
            const attempts = row.attempts + 1;
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                attempts,
                availableAt: new Date(Date.now() + retryDelayMs(attempts)),
                lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
              },
            });
          }
        }
        return rows.length;
      },
      { maxWait: 30_000, timeout: 60_000 },
    );
  }
}
