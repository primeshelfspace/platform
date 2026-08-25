import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  idSchema,
  invoiceDraftSchema,
  invoiceListQuerySchema,
  type InvoiceDraftInput,
  type InvoiceListQuery,
  type Scope,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import {
  InvoicesService,
  type InvoiceActivityEntry,
  type InvoiceDetail,
  type InvoiceListResult,
  type InvoiceSummary,
  type InvoiceWithLines,
} from './invoices.service.js';

/** FR-INV. Nested under the brand, matching CustomersController's convention. */
@Controller('brands/:brandId/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('INVOICES', 'READ')
  list(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Query(zodPipe(invoiceListQuerySchema)) query: InvoiceListQuery,
  ): Promise<InvoiceListResult> {
    return this.invoices.list(scope, brandId, query);
  }

  /** Declared before the ':id' route below — Nest matches in declaration
   * order, and 'summary' would otherwise be swallowed as an invoice id (and
   * then rejected by idSchema as a malformed UUID). */
  @Get('summary')
  @RequirePermission('INVOICES', 'READ')
  summary(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
  ): Promise<InvoiceSummary> {
    return this.invoices.summary(scope, brandId);
  }

  @Get(':id')
  @RequirePermission('INVOICES', 'READ')
  findOne(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
  ): Promise<InvoiceDetail> {
    return this.invoices.findOne(scope, brandId, id);
  }

  /** The Invoice Details screen's "Activity" tab. */
  @Get(':id/events')
  @RequirePermission('INVOICES', 'READ')
  events(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
  ): Promise<InvoiceActivityEntry[]> {
    return this.invoices.getActivity(scope, brandId, id);
  }

  @Post()
  @RequirePermission('INVOICES', 'WRITE')
  create(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(invoiceDraftSchema)) body: InvoiceDraftInput,
  ): Promise<InvoiceWithLines> {
    return this.invoices.create(scope, brandId, body);
  }

  @Post(':id/issue')
  @RequirePermission('INVOICE_SEND', 'WRITE')
  issue(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
  ): Promise<InvoiceWithLines> {
    return this.invoices.issue(scope, brandId, id);
  }

  /** The Invoice Details screen's "Resend" button — a real send to the
   * customer's actual email, not a status change (see InvoicesService). */
  @Post(':id/resend')
  @HttpCode(200)
  @RequirePermission('INVOICE_SEND', 'WRITE')
  async resend(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
  ): Promise<{ sent: true }> {
    await this.invoices.resendEmail(scope, brandId, id);
    return { sent: true };
  }
}
