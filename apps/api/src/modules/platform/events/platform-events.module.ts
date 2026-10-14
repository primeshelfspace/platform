import { Global, Module } from '@nestjs/common';
import { PlatformOutbox } from './platform-outbox.js';

/** Global within the app so every platform module can record events; products
 * cannot import PlatformOutbox (not part of the platform's public API) — they
 * subscribe to the topics in ./contracts.ts instead. */
@Global()
@Module({
  providers: [PlatformOutbox],
  exports: [PlatformOutbox],
})
export class PlatformEventsModule {}
