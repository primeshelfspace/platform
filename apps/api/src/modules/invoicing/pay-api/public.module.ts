import { Module } from '@nestjs/common';
import { StorageModule } from '../../../shared/adapters/storage/storage.module.js';
import { IntegrationsModule } from '../../platform/modules.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { ZohoSyncModule } from '../zoho-sync/zoho-sync.module.js';
import { InvoicePdfService } from './infrastructure/invoice-pdf.service.js';
import { PublicInvoicesController } from './interface/public-invoices.controller.js';
import { InvoicePdfDownloadService } from './application/invoice-pdf-download.service.js';
import { PublicInvoicesService } from './application/public-invoices.service.js';

@Module({
  // StorageModule resolves brand logo URLs onto the public payment page —
  // PublicInvoicesService takes StoragePort as its third constructor arg.
  // IntegrationsModule for StripeAccountService (the brand's connected Stripe
  // account); ZohoSyncModule for ZohoPullService's line-item fallback.
  imports: [PaymentsModule, IntegrationsModule, ZohoSyncModule, StorageModule],
  controllers: [PublicInvoicesController],
  providers: [PublicInvoicesService, InvoicePdfDownloadService, InvoicePdfService],
  // InvoicePdfService is also used by InvoicesModule, to attach a PDF to a
  // sent invoice email — one headless-Chromium instance for the whole
  // process, not a second one per module.
  exports: [InvoicePdfService],
})
export class PublicModule {}
