import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';

/** Global: every module may subscribe to events and register its outbox. */
@Global()
@Module({
  providers: [EventBus, OutboxDispatcher],
  exports: [EventBus, OutboxDispatcher],
})
export class EventsModule {}
