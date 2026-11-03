import { Module } from '@nestjs/common';
import { BrandReplicaProjector } from './application/brand-replica.projector.js';

/** HQ's subscriptions to platform events: the local copies of platform data
 * HQ keeps (today, brands). */
@Module({
  providers: [BrandReplicaProjector],
})
export class PlatformSyncModule {}
