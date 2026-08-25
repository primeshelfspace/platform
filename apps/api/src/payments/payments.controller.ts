import { Controller, Get, Param, Query } from '@nestjs/common';
import { idSchema, paginationSchema, type Pagination, type Scope } from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import { PaymentsService, type PaymentListResult } from './payments.service.js';

/** Backs the Transaction Log on Brand Settings → Payment Gateways — see
 * PaymentsService.list for why this is not filtered by gateway provider. */
@Controller('brands/:brandId/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission('PAYMENTS', 'READ')
  list(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Query(zodPipe(paginationSchema)) query: Pagination,
  ): Promise<PaymentListResult> {
    return this.payments.list(scope, brandId, query);
  }
}
