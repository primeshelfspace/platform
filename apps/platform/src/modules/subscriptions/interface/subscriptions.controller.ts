import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { type Product, type RequestScope } from '@platform/kernel';
import {
  productSchema,
  updateSubscriptionSchema,
  type UpdateSubscriptionInput,
} from '@platform/platform-contracts';
import { zodPipe } from '@platform/server';
import { CurrentScope, RequirePermission } from '@platform/server';
import {
  SubscriptionsService,
  type ProductSubscription,
} from '../application/subscriptions.service.js';

/**
 * The company's products. PLAN_AND_BILLING is owner-only in the matrix; every
 * other user learns which products they can open from GET /auth/me instead.
 */
@Controller('company/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequirePermission('PLAN_AND_BILLING', 'READ', { brandFrom: 'none' })
  list(@CurrentScope() scope: RequestScope): Promise<ProductSubscription[]> {
    return this.subscriptions.list(scope);
  }

  @Put(':product')
  @RequirePermission('PLAN_AND_BILLING', 'WRITE', { brandFrom: 'none' })
  update(
    @CurrentScope() scope: RequestScope,
    @Param('product', zodPipe(productSchema)) product: Product,
    @Body(zodPipe(updateSubscriptionSchema)) body: UpdateSubscriptionInput,
  ): Promise<ProductSubscription> {
    return this.subscriptions.update(scope, product, body);
  }
}
