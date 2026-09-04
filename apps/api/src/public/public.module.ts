import { Module } from '@nestjs/common';
import { StorageModule } from '../adapters/storage/storage.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { PublicInvoicesController } from './public-invoices.controller.js';
import { PublicInvoicesService } from './public-invoices.service.js';

@Module({
  // StorageModule resolves brand logo URLs onto the public payment page —
  // PublicInvoicesService takes StoragePort as its third constructor arg.
  imports: [PaymentsModule, IntegrationsModule, StorageModule],
  controllers: [PublicInvoicesController],
  providers: [PublicInvoicesService, InvoicePdfService],
  // InvoicePdfService is also used by InvoicesModule, to attach a PDF to a
  // sent invoice email — one headless-Chromium instance for the whole
  // process, not a second one per module.
  exports: [InvoicePdfService],
})
export class PublicModule {}
