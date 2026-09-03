import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  formatDateForDisplay,
  formatMinorForDisplay,
  idSchema,
  paymentIntentRequestSchema,
  publicTokenSchema,
  renderInvoicePdfHtml,
  toCurrencyCode,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { Public } from '../tenancy/authorisation.js';
import { PaymentsService, type PaymentAttemptResult } from '../payments/payments.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { PublicInvoicesService, type PublicInvoiceView } from './public-invoices.service.js';

const createIntentBodySchema = paymentIntentRequestSchema.pick({
  method: true,
  attemptNonce: true,
});
type CreateIntentBody = z.infer<typeof createIntentBodySchema>;

/**
 * The anonymous payment path (TDD-001 §12.1). Every route here is @Public();
 * the token is the only credential, and every failure mode — unknown token,
 * deactivated token, wrong brand — collapses to the same 404 so the endpoint
 * cannot be used to probe which invoices exist.
 */
@Controller('public')
export class PublicInvoicesController {
  constructor(
    private readonly publicInvoices: PublicInvoicesService,
    private readonly payments: PaymentsService,
    private readonly invoicePdf: InvoicePdfService,
  ) {}

  @Get('invoices/:token')
  @Public()
  async view(
    @Param('token', zodPipe(publicTokenSchema)) token: string,
  ): Promise<PublicInvoiceView> {
    const scope = await this.publicInvoices.resolveScope(token);
    if (!scope) throw new NotFoundException('this payment link is no longer valid');

    const view = await this.publicInvoices.view(scope);
    if (!view) throw new NotFoundException('this payment link is no longer valid');
    return view;
  }

  /**
   * The invoice as a real downloadable PDF (FR-PAY "Download PDF") — the
   * admin Invoices detail drawer's Download PDF button and the payment
   * page's own "Download invoice" both point here. Same token-only auth and
   * same 404-collapses-every-failure shape as `view` above, deliberately:
   * this is not a new access-control surface, just a second representation
   * of the same data.
   */
  @Get('invoices/:token/pdf')
  @Public()
  async pdf(
    @Param('token', zodPipe(publicTokenSchema)) token: string,
    @Res() response: Response,
  ): Promise<void> {
    const scope = await this.publicInvoices.resolveScope(token);
    if (!scope) throw new NotFoundException('this payment link is no longer valid');

    const view = await this.publicInvoices.view(scope);
    if (!view) throw new NotFoundException('this payment link is no longer valid');

    const currency = toCurrencyCode(view.currency);
    const html = renderInvoicePdfHtml({
      number: view.number,
      invoiceDate: formatDateForDisplay(view.invoiceDate),
      dueDate: formatDateForDisplay(view.dueDate),
      brand: view.brand,
      customerName: view.customerName,
      customerAddress: view.customerAddress,
      settings: view.invoicePdf,
      lines: view.lines.map((line) => ({
        itemName: line.itemName,
        quantityLabel: line.quantity,
        rateLabel: formatMinorForDisplay(line.unitPriceMinor, currency),
        amountLabel: formatMinorForDisplay(line.lineTotalMinor, currency),
      })),
      subtotalLabel: formatMinorForDisplay(view.subtotalMinor, currency),
      totalLabel: formatMinorForDisplay(view.totalMinor, currency),
      balanceDueLabel: formatMinorForDisplay(view.balanceMinor, currency),
    });

    const pdf = await this.invoicePdf.render(html);
    response.setHeader('content-type', 'application/pdf');
    response.setHeader('content-disposition', `attachment; filename="invoice-${view.number}.pdf"`);
    response.send(pdf);
  }

  @Post('invoices/:token/payment-intents')
  @Public()
  async createIntent(
    @Param('token', zodPipe(publicTokenSchema)) token: string,
    @Body(zodPipe(createIntentBodySchema)) body: CreateIntentBody,
  ): Promise<PaymentAttemptResult> {
    const scope = await this.publicInvoices.resolveScope(token);
    if (!scope) throw new NotFoundException('this payment link is no longer valid');

    return this.payments.createIntent(scope, body.method, body.attemptNonce);
  }

  @Post('webhooks/fake-gateway')
  @Public()
  @HttpCode(200)
  async fakeGatewayWebhook(@Req() request: RawBodyRequest<Request>): Promise<{ received: true }> {
    if (!request.rawBody) {
      throw new BadRequestException('missing request body');
    }
    await this.payments.handleWebhook(request.rawBody, request.headers as Record<string, string>);
    return { received: true };
  }

  /**
   * One endpoint for every brand (Stripe Connect). Connected-account events all
   * arrive here, signed with the single platform webhook secret and tagged with
   * the account they came from, so there is no per-brand URL to register and no
   * per-brand signing secret to collect. PaymentsService.handleWebhook maps that
   * account back to a brand before settling anything — see its comment for why
   * the signature alone is no longer sufficient to establish tenancy.
   *
   * Register this once, in the platform's own Stripe dashboard, listening to
   * events "on connected accounts".
   */
  @Post('webhooks/stripe')
  @Public()
  @HttpCode(200)
  async stripeWebhook(@Req() request: RawBodyRequest<Request>): Promise<{ received: true }> {
    if (!request.rawBody) {
      throw new BadRequestException('missing request body');
    }
    await this.payments.handleWebhook(request.rawBody, request.headers as Record<string, string>);
    return { received: true };
  }
}
