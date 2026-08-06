import { Module } from '@nestjs/common';
import { StorageModule } from '../adapters/storage/storage.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PublicInvoicesController } from './public-invoices.controller.js';
import { PublicInvoicesService } from './public-invoices.service.js';

@Module({
  // StorageModule resolves brand logo URLs onto the public payment page —
  // PublicInvoicesService takes StoragePort as its third constructor arg.
  imports: [PaymentsModule, IntegrationsModule, StorageModule],
  controllers: [PublicInvoicesController],
  providers: [PublicInvoicesService],
})
export class PublicModule {}
