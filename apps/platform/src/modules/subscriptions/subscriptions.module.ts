import { Module } from '@nestjs/common';
import { SubscriptionsController } from './interface/subscriptions.controller.js';
import { SubscriptionsService } from './application/subscriptions.service.js';

@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
