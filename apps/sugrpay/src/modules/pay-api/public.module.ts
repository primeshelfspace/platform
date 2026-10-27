import { Module } from '@nestjs/common';
import { MailModule, StorageModule } from '@platform/server';
import { PaymentsModule } from '../payments/payments.module.js';
import { ZohoSyncModule } from '../zoho-sync/zoho-sync.module.js';
import { InvoicePdfService } from './infrastructure/invoice-pdf.service.js';
import { PublicInvoicesController } from './interface/public-invoices.controller.js';
import { InvoicePdfDownloadService } from './application/invoice-pdf-download.service.js';
import { MailEventsService } from './application/mail-events.service.js';
import { PublicInvoicesService } from './application/public-invoices.service.js';

@Module({
  // StorageModule resolves brand logo URLs onto the public payment page —
  // PublicInvoicesService takes StoragePort as its third constructor arg.
  // for StripeAccountService (the brand's connected Stripe
  // account); ZohoSyncModule for ZohoPullService's line-item fallback;
  // MailModule for MailEventsService's MAIL_PORT (verifying/parsing the
  // provider's delivery-event webhook with the same adapter that sent it).
  imports: [PaymentsModule, ZohoSyncModule, StorageModule, MailModule],
  controllers: [PublicInvoicesController],
  providers: [PublicInvoicesService, InvoicePdfDownloadService, InvoicePdfService, MailEventsService],
  // InvoicePdfService is also used by InvoicesModule, to attach a PDF to a
  // sent invoice email — one headless-Chromium instance for the whole
  // process, not a second one per module.
  exports: [InvoicePdfService],
})
export class PublicModule {}
