import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PLATFORM_EVENTS } from '@platform/platform-contracts';
import { ENV, EventBus, InternalClient, type DeliveredEvent, type Env } from '@platform/server';

/**
 * Hands every platform event to the product APIs over HTTP: Sugrpay always,
 * HQ once HQ_INTERNAL_URL is set (a server where HQ has no database yet gets
 * none). The platform's outbox delivers to each as its own subscriber, so
 * delivery stays reliable and independent: if one product is down or answers
 * an error, only its delivery is retried later, with backoff. Each product
 * skips duplicates by event id.
 */
@Injectable()
export class EventForwarder implements OnModuleInit {
  private readonly sugrpay: InternalClient | null;
  private readonly hq: InternalClient | null;

  constructor(
    private readonly bus: EventBus,
    @Inject(ENV) env: Env,
  ) {
    this.sugrpay = env.INTERNAL_API_KEY
      ? new InternalClient(env.SUGRPAY_INTERNAL_URL, env.INTERNAL_API_KEY, 10_000)
      : null;
    this.hq =
      env.INTERNAL_API_KEY && env.HQ_INTERNAL_URL
        ? new InternalClient(env.HQ_INTERNAL_URL, env.INTERNAL_API_KEY, 10_000)
        : null;
  }

  onModuleInit(): void {
    for (const topic of Object.values(PLATFORM_EVENTS)) {
      this.bus.subscribe(topic, 'forward-to-sugrpay', (event) => this.forward(event));
      if (this.hq) {
        const hq = this.hq;
        this.bus.subscribe(topic, 'forward-to-hq', async (event) => {
          await hq.request('POST', '/internal/events', event);
        });
      }
    }
  }

  private async forward(event: DeliveredEvent): Promise<void> {
    if (!this.sugrpay) {
      throw new Error('INTERNAL_API_KEY is not set: platform events cannot reach Sugrpay');
    }
    await this.sugrpay.request('POST', '/internal/events', event);
  }
}
