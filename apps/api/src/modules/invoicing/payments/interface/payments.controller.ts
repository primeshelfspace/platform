import { Controller, Get, Param, Query } from '@nestjs/common';
import { paymentListQuerySchema, type PaymentListQuery } from '@platform/invoicing-contracts';
import { idSchema, type Scope } from '@platform/kernel';
import { zodPipe } from '../../../../shared/common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission, ProductScope } from '../../../platform/public-api.js';
import { PaymentsService, type PaymentListResult } from '../application/payments.service.js';

/** Backs the Transaction Log on Brand Settings → Payment Gateways — see
 * PaymentsService.list for why this is not filtered by gateway provider. */
@ProductScope('INVOICING')
@Controller('brands/:brandId/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission('PAYMENTS', 'READ')
  list(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Query(zodPipe(paymentListQuerySchema)) query: PaymentListQuery,
  ): Promise<PaymentListResult> {
    return this.payments.list(scope, brandId, query);
  }
}
