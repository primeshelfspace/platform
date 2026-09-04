import { Module } from '@nestjs/common';
import { MailModule } from '../adapters/mail/mail.module.js';
import { StorageModule } from '../adapters/storage/storage.module.js';
import { PublicModule } from '../public/public.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';

@Module({
  // PublicModule only for its exported InvoicePdfService (attaching a PDF to
  // a sent invoice email) — not a real dependency on the public payment path.
  imports: [MailModule, StorageModule, PublicModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
