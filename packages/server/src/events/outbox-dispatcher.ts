import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { EventBus, type DeliveredEvent } from './event-bus.js';

/**
 * A module's outbox, as seen by the dispatcher. Each module that publishes
 * events implements one over its own database and registers it.
 */
export interface OutboxSource {
  readonly name: string;
  /**
   * Claims up to `limit` events that are due, hands each to `deliver`, and
   * records the outcome (delivered, or failed with backoff). Must lock the
   * claimed rows so two processes never deliver the same event at once.
   * Returns how many events it claimed.
   */
  drain(limit: number, deliver: (event: DeliveredEvent) => Promise<void>): Promise<number>;
}

/** Retry backoff: 1s, 2s, 4s ... capped at 5 minutes. */
export function retryDelayMs(attempts: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000);
}

const BATCH_SIZE = 50;

/**
 * Delivers outbox events to the in-process EventBus.
 *
 * Two triggers: `flush()`, which a producer awaits right after committing so
 * subscribers see the change immediately (a brand created in the platform is
 * usable in invoicing on the very next request), and a poll every
 * OUTBOX_POLL_INTERVAL_MS, which retries failures and picks up anything a
 * crashed process left behind. Runs in the API and the worker alike; row
 * locks keep them from delivering the same event twice concurrently.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly sources: OutboxSource[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(
    private readonly bus: EventBus,
    @Inject(ENV) private readonly env: Env,
  ) {}

  register(source: OutboxSource): void {
    this.sources.push(source);
  }

  onApplicationBootstrap(): void {
    const interval = this.env.OUTBOX_POLL_INTERVAL_MS;
    if (interval <= 0) return;
    this.timer = setInterval(() => {
      this.flush().catch((error: unknown) =>
        this.logger.warn(`outbox poll failed: ${error instanceof Error ? error.message : error}`),
      );
    }, interval);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Delivers everything currently due, from every source. Concurrent callers
   * share one run rather than racing each other. Never throws for a handler
   * failure — that event is rescheduled and the rest still go out.
   * Returns how many events were processed.
   */
  async flush(): Promise<number> {
    if (this.running) {
      await this.running;
    }
    this.running = this.drainAll();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  private async drainAll(): Promise<number> {
    let total = 0;
    for (const source of this.sources) {
      // Keep draining while full batches come back.
      for (;;) {
        const claimed = await source.drain(BATCH_SIZE, (event) => this.bus.deliver(event));
        total += claimed;
        if (claimed < BATCH_SIZE) break;
      }
    }
    return total;
  }
}
