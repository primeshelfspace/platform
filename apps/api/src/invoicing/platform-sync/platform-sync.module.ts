import { Module } from '@nestjs/common';
import { BrandReplicaProjector } from './brand-replica.projector.js';

/** Invoicing's subscriptions to platform events: the local copies of
 * platform data that invoicing keeps (today, brands). */
@Module({
  providers: [BrandReplicaProjector],
})
export class PlatformSyncModule {}
