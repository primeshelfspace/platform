import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  bulkSendInvoicesSchema,
  invoiceDraftSchema,
  invoiceListQuerySchema,
  invoiceTabCountsQuerySchema,
  recordManualPaymentSchema,
  sendInvoiceEmailSchema,
  type BulkSendInvoicesInput,
  type EmailReceiptLayout,
  type InvoiceDraftInput,
  type InvoiceListQuery,
  type InvoiceTabCountsQuery,
  type RecordManualPaymentInput,
  type SendInvoiceEmailInput,
} from '@platform/invoicing-contracts';
import { idSchema, type Scope } from '@platform/kernel';
import { zodPipe } from '@platform/server';
import { CurrentScope, RequirePermission, ProductScope } from '@platform/server';
import {
  InvoicesService,
  type BulkSendResult,
  type InvoiceActivityEntry,
  type InvoiceDetail,
  type InvoiceListResult,
  type InvoiceSummary,
  type InvoiceTabCounts,
  type InvoiceWithLines,
} from '../application/invoices.service.js';
import { RateLimit } from '@platform/server';

/** FR-INV. Nested under the brand, matching CustomersController's convention. */
@ProductScope('INVOICING')
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

  /** The Invoices list's tab badges (All/Draft/Unpaid/Partial/Paid/Overdue) —
   * declared before ':id' for the same reason 'summary' is. */
  @Get('tab-counts')
  @RequirePermission('INVOICES', 'READ')
  tabCounts(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Query(zodPipe(invoiceTabCountsQuerySchema)) query: InvoiceTabCountsQuery,
  ): Promise<InvoiceTabCounts> {
    return this.invoices.tabCounts(scope, brandId, query);
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

  /** Download PDF on the Invoice Details panel, for any status, drafts too
   * (the public PDF route needs a live payment link, which a draft has not). */
  @Get(':id/pdf')
  @RequirePermission('INVOICES', 'READ')
  async pdf(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { number, pdf } = await this.invoices.pdf(scope, brandId, id);
    response.setHeader('content-type', 'application/pdf');
    response.setHeader('content-disposition', `attachment; filename="invoice-${number}.pdf"`);
    response.setHeader('cache-control', 'no-store');
    response.send(pdf);
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

  /** Edit a draft (the Invoice Details panel's Edit). The whole draft is
   * replaced and recalculated; issued invoices are refused. */
  @Put(':id')
  @RequirePermission('INVOICES', 'WRITE')
  update(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(invoiceDraftSchema)) body: InvoiceDraftInput,
  ): Promise<InvoiceWithLines> {
    return this.invoices.updateDraft(scope, brandId, id, body);
  }

  /** The Invoices list's "Bulk Send Invoices" — sends (or resends) each
   * selected invoice with its own default Email Receipt content; a draft
   * among them is issued first, same as a first send from the drawer. */
  @Post('bulk-send')
  @RateLimit({ name: 'invoice-bulk-send', windowSeconds: 86400, perCompanyLimit: 20 })
  @HttpCode(200)
  @RequirePermission('INVOICE_SEND', 'WRITE')
  bulkSend(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(bulkSendInvoicesSchema)) body: BulkSendInvoicesInput,
  ): Promise<BulkSendResult> {
    return this.invoices.bulkSend(scope, brandId, body.ids);
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

  /** The Invoice Details drawer's compose modal opening a Send/Resend —
   * pre-filled subject/body/to for this exact invoice. */
  @Get(':id/email-preview')
  @RequirePermission('INVOICES', 'READ')
  emailPreview(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
  ): Promise<{
    to: string;
    subject: string;
    body: string;
    layout: EmailReceiptLayout;
    accentColor: string;
  }> {
    return this.invoices.prepareEmail(scope, brandId, id);
  }

  /** The Invoice Details drawer's "Send"/"Resend" button — one real send
   * either way, to whatever the compose modal actually shows (see
   * InvoicesService.sendEmail). Not a status change; the drawer calls
   * :id/issue separately first when sending a draft for the first time. */
  @Post(':id/send-email')
  @RateLimit({ name: 'invoice-email', windowSeconds: 86400, perCompanyLimit: 300 })
  @HttpCode(200)
  @RequirePermission('INVOICE_SEND', 'WRITE')
  async sendEmail(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(sendInvoiceEmailSchema)) body: SendInvoiceEmailInput,
  ): Promise<{ sent: true; rejected: readonly string[] }> {
    // rejected: addresses the mail server refused while taking the others
    // (e.g. a mistyped CC). Empty when everyone got it.
    const { rejected } = await this.invoices.sendEmail(scope, brandId, id, body);
    return { sent: true, rejected };
  }

  /** The Invoice Details drawer's "Record Payment" — money received outside
   * the platform. Gated on PAYMENTS WRITE (Owner, Merchant Admin, Brand
   * Admin, Finance), not INVOICES WRITE, since it moves the balance. */
  @Post(':id/payments')
  @RequirePermission('PAYMENTS', 'WRITE')
  recordPayment(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(recordManualPaymentSchema)) body: RecordManualPaymentInput,
  ): Promise<InvoiceWithLines> {
    return this.invoices.recordManualPayment(scope, brandId, id, body);
  }

  /** The Invoice Details drawer's "Cancel Invoice" — a void, hence DELETE. */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('INVOICES', 'DELETE')
  cancel(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
  ): Promise<InvoiceWithLines> {
    return this.invoices.cancel(scope, brandId, id);
  }
}
