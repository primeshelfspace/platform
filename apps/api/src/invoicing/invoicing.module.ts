import { Module } from '@nestjs/common';
import { ChecksModule } from './checks/checks.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { PublicModule } from './pay-api/public.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { BrandSettingsModule } from './settings/brand-settings.module.js';
import { ZohoSyncModule } from './zoho-sync/zoho-sync.module.js';

/** The invoicing product (Sugrpay): customers, invoices, payments, the public
 * payment page API, brand invoice settings and Zoho Books sync. */
@Module({
  imports: [
    BrandSettingsModule,
    CustomersModule,
    InvoicesModule,
    PaymentsModule,
    ChecksModule,
    PublicModule,
    ZohoSyncModule,
    DashboardModule,
  ],
  exports: [ZohoSyncModule],
})
export class InvoicingModule {}
