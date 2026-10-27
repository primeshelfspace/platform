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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  createCheckSubmissionSchema,
  paymentIntentReconcileSchema,
  paymentIntentRequestSchema,
  type CreateCheckSubmissionInput,
} from '@platform/invoicing-contracts';
import { idSchema, publicTokenSchema } from '@platform/kernel';
import { assertCheckImage, MAX_CHECK_IMAGE_BYTES } from '../../../common/check-upload.js';
import { zodPipe } from '@platform/server';
import { Public, ProductScope } from '@platform/server';
import {
  PaymentsService,
  type PaymentAttemptResult,
} from '../../payments/application/payments.service.js';
import { InvoicePdfDownloadService } from '../application/invoice-pdf-download.service.js';
import { MailEventsService } from '../application/mail-events.service.js';
import {
  PublicInvoicesService,
  type PublicInvoiceView,
} from '../application/public-invoices.service.js';
import { RateLimit } from '@platform/server';

const createIntentBodySchema = paymentIntentRequestSchema
  .pick({ method: true, attemptNonce: true })
  // MANUAL is how staff record cash or a wire — never a method a customer
  // can start from the payment page.
  .refine((body) => body.method !== 'MANUAL', {
    message: 'unsupported payment method',
    path: ['method'],
  });
type CreateIntentBody = z.infer<typeof createIntentBodySchema>;
type ReconcileBody = z.infer<typeof paymentIntentReconcileSchema>;

/**
 * The anonymous payment path (TDD-001 §12.1). Every route here is @Public();
 * the token is the only credential, and every failure mode — unknown token,
 * deactivated token, wrong brand — collapses to the same 404 so the endpoint
 * cannot be used to probe which invoices exist.
 */
@ProductScope('INVOICING')
@Controller('public')
export class PublicInvoicesController {
  constructor(
    private readonly publicInvoices: PublicInvoicesService,
    private readonly payments: PaymentsService,
    private readonly pdfDownloads: InvoicePdfDownloadService,
    private readonly mailEvents: MailEventsService,
  ) {}

  @Get('invoices/:token')
  @RateLimit({ name: 'public-invoice', limit: 120, windowSeconds: 60, perTokenLimit: 300 })
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
  @RateLimit({ name: 'public-pdf', limit: 20, windowSeconds: 60, perTokenLimit: 30 })
  @Public()
  async pdf(
    @Param('token', zodPipe(publicTokenSchema)) token: string,
    @Res() response: Response,
  ): Promise<void> {
    const download = await this.pdfDownloads.forToken(token);
    if (!download) throw new NotFoundException('this payment link is no longer valid');

    response.setHeader('content-type', 'application/pdf');
    response.setHeader(
      'content-disposition',
      `attachment; filename="invoice-${download.number}.pdf"`,
    );
    // The balance and the brand's Invoice PDF layout can both change between
    // one download and the next; without this a browser that already cached
    // this exact URL will hand back a stale PDF instead of asking again.
    response.setHeader('cache-control', 'no-store');
    response.send(download.pdf);
  }

  @Post('invoices/:token/payment-intents')
  @RateLimit({ name: 'payment-intent', limit: 10, windowSeconds: 600, perTokenLimit: 20 })
  @Public()
  async createIntent(
    @Param('token', zodPipe(publicTokenSchema)) token: string,
    @Body(zodPipe(createIntentBodySchema)) body: CreateIntentBody,
  ): Promise<PaymentAttemptResult> {
    const scope = await this.publicInvoices.resolveScope(token);
    if (!scope) throw new NotFoundException('this payment link is no longer valid');

    return this.payments.createIntent(scope, body.method, body.attemptNonce);
  }

  /**
   * Upload Check's customer-facing half (FR-PAY) — front/back photos plus the
   * check number arrive as multipart fields alongside the two image parts,
   * rather than as a JSON body the way every other method's intent request
   * is shaped; there is no payment-intent/gateway step for this method, just
   * a row ChecksService's staff-facing review queue (Payments > Check
   * Verifications) reads from.
   */
  @Post('invoices/:token/checks')
  @RateLimit({ name: 'check-upload', limit: 5, windowSeconds: 3600, perTokenLimit: 10 })
  @Public()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'front', maxCount: 1 },
        { name: 'back', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_CHECK_IMAGE_BYTES } },
    ),
  )
  async submitCheck(
    @Param('token', zodPipe(publicTokenSchema)) token: string,
    @Body(zodPipe(createCheckSubmissionSchema)) body: CreateCheckSubmissionInput,
    @UploadedFiles() files: { front?: Express.Multer.File[]; back?: Express.Multer.File[] },
  ): Promise<{ id: string }> {
    const scope = await this.publicInvoices.resolveScope(token);
    if (!scope) throw new NotFoundException('this payment link is no longer valid');

    const front = files.front?.[0];
    const back = files.back?.[0];
    assertCheckImage(front, 'front');
    assertCheckImage(back, 'back');

    return this.publicInvoices.submitCheck(scope, body, {
      front: { buffer: front.buffer, mimetype: front.mimetype, size: front.size },
      back: { buffer: back.buffer, mimetype: back.mimetype, size: back.size },
    });
  }

  /**
   * Called by the payment page right after Stripe.js itself confirms a
   * result in the browser (FR-PAY, gateway-webhook fallback) — a safety net
   * for a deployment whose webhook endpoint the gateway cannot reach yet.
   * Nothing here is taken on faith: PaymentsService re-fetches this exact
   * attempt's status from the gateway before touching anything.
   */
  @Post('invoices/:token/payment-intents/reconcile')
  @RateLimit({ name: 'payment-reconcile', limit: 60, windowSeconds: 600 })
  @Public()
  async reconcileIntent(
    @Param('token', zodPipe(publicTokenSchema)) token: string,
    @Body(zodPipe(paymentIntentReconcileSchema)) body: ReconcileBody,
  ): Promise<PaymentAttemptResult> {
    const scope = await this.publicInvoices.resolveScope(token);
    if (!scope) throw new NotFoundException('this payment link is no longer valid');

    return this.payments.confirmClientResult(scope, body.gatewayReference);
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

  /**
   * The mail provider's delivery/bounce/complaint callback (FR-PAY §10.2,
   * mirrors the two webhooks above). Everything this endpoint accepts is
   * already in SmtpMailAdapter's own internal format — see its
   * verifySignature/parseDeliveryEvent for the shape a provider must be
   * configured to post in, since there is no single universal format across
   * SMTP relays the way there is for a single gateway's SDK.
   */
  @Post('webhooks/mail')
  @Public()
  @HttpCode(200)
  async mailWebhook(@Req() request: RawBodyRequest<Request>): Promise<{ received: true }> {
    if (!request.rawBody) {
      throw new BadRequestException('missing request body');
    }
    await this.mailEvents.handleWebhook(request.rawBody, request.headers as Record<string, string>);
    return { received: true };
  }
}
