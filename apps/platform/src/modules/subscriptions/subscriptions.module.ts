import { Module } from '@nestjs/common';
import { SubscriptionsController } from './interface/subscriptions.controller.js';
import { SubscriptionsService } from './application/subscriptions.service.js';
import { ProductsController } from './interface/products.controller.js';
import { ProductsService } from './application/products.service.js';

@Module({
  controllers: [SubscriptionsController, ProductsController],
  providers: [SubscriptionsService, ProductsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
