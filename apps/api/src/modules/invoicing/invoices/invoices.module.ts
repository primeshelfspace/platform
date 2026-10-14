import { Module } from '@nestjs/common';
import { MailModule } from '../../../shared/adapters/mail/mail.module.js';
import { StorageModule } from '../../../shared/adapters/storage/storage.module.js';
import { PublicModule } from '../pay-api/public.module.js';
import { ZohoSyncModule } from '../zoho-sync/zoho-sync.module.js';
import { InvoicesController } from './interface/invoices.controller.js';
import { InvoicesService } from './application/invoices.service.js';

@Module({
  // PublicModule only for its exported InvoicePdfService (attaching a PDF to
  // a sent invoice email) — not a real dependency on the public payment path.
  // ZohoSyncModule only for ZohoPullService's on-demand line-item
  // enrichment (findOne) — not a dependency on the rest of the sync pipeline.
  imports: [MailModule, StorageModule, PublicModule, ZohoSyncModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
