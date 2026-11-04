import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { EventBus, InternalOnly, zodPipe } from '@platform/server';
import { z } from 'zod';

const deliveredEventSchema = z.object({
  id: z.string().uuid(),
  topic: z.string().min(1).max(200),
  aggregateId: z.string().min(1).max(200),
  occurredAt: z.coerce.date(),
  payload: z.unknown(),
});

/**
 * Where the platform delivers its events (brand created/updated, …) — the
 * other half of the platform's EventForwarder, as in Sugrpay. Handed to HQ's
 * own event bus, so subscribers such as the brand-copy projector stay plain
 * event handlers. A subscriber failure answers 500, which makes the platform
 * retry later.
 */
@Controller('internal')
export class InternalEventsController {
  constructor(private readonly bus: EventBus) {}

  @Post('events')
  @InternalOnly()
  @HttpCode(204)
  async receive(
    @Body(zodPipe(deliveredEventSchema)) event: z.infer<typeof deliveredEventSchema>,
  ): Promise<void> {
    await this.bus.deliver({ ...event, payload: event.payload ?? null });
  }
}
