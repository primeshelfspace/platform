import { Injectable, Logger } from '@nestjs/common';

/** An event as delivered to subscribers. `payload` is the module's own
 * published contract for `topic` — see each module's events/contracts.ts. */
export interface DeliveredEvent<TPayload = unknown> {
  readonly id: string;
  readonly topic: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

export type EventHandler<TPayload = unknown> = (event: DeliveredEvent<TPayload>) => Promise<void>;

interface Subscription {
  readonly name: string;
  readonly handler: EventHandler;
}

/**
 * In-process publish/subscribe — the "Tell" half of how modules talk.
 *
 * Producers never call this directly: they write to their own outbox in the
 * same transaction as the change, and the OutboxDispatcher delivers from
 * there. That is what makes delivery reliable — an event exists if and only
 * if its change committed, and a failed handler is retried.
 *
 * Delivery is at-least-once, so every handler must be idempotent (record the
 * event id in its own database in the same transaction as its own change).
 *
 * If a module is ever split into its own service, this is the seam where a
 * message broker replaces in-process delivery; producers and handlers keep
 * their shape.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly subscriptions = new Map<string, Subscription[]>();

  /** `name` identifies the handler in logs and retry errors. */
  subscribe<TPayload>(topic: string, name: string, handler: EventHandler<TPayload>): void {
    const list = this.subscriptions.get(topic) ?? [];
    list.push({ name, handler: handler as EventHandler });
    this.subscriptions.set(topic, list);
  }

  /**
   * Runs every handler for the event's topic. Handlers are independent: all
   * of them run even if one fails, and the failure is rethrown afterwards so
   * the dispatcher retries the event (handlers that already succeeded skip
   * the duplicate by event id).
   */
  async deliver(event: DeliveredEvent): Promise<void> {
    const failures: string[] = [];
    for (const { name, handler } of this.subscriptions.get(event.topic) ?? []) {
      try {
        await handler(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`${name} failed on ${event.topic} ${event.id}: ${message}`);
        failures.push(`${name}: ${message}`);
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
  }
}
