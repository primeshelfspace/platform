import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PLATFORM_EVENTS } from '@platform/platform-contracts';
import { ENV, EventBus, InternalClient, type DeliveredEvent, type Env } from '@platform/server';

/**
 * Hands every platform event to the product APIs over HTTP. The platform's
 * outbox delivers to this like to any subscriber, so delivery stays reliable:
 * if Sugrpay is down or answers an error, this throws, and the outbox retries
 * the event later with backoff. Sugrpay skips duplicates by event id.
 */
@Injectable()
export class EventForwarder implements OnModuleInit {
  private readonly sugrpay: InternalClient | null;

  constructor(
    private readonly bus: EventBus,
    @Inject(ENV) env: Env,
  ) {
    this.sugrpay = env.INTERNAL_API_KEY
      ? new InternalClient(env.SUGRPAY_INTERNAL_URL, env.INTERNAL_API_KEY, 10_000)
      : null;
  }

  onModuleInit(): void {
    for (const topic of Object.values(PLATFORM_EVENTS)) {
      this.bus.subscribe(topic, 'forward-to-sugrpay', (event) => this.forward(event));
    }
  }

  private async forward(event: DeliveredEvent): Promise<void> {
    if (!this.sugrpay) {
      throw new Error('INTERNAL_API_KEY is not set: platform events cannot reach Sugrpay');
    }
    await this.sugrpay.request('POST', '/internal/events', event);
  }
}
