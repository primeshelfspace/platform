import { Module } from '@nestjs/common';
import { AccountingModule } from '../adapters/accounting/accounting.module.js';
import { IntegrationConnectionService } from './integration-connection.service.js';
import { PaymentGatewaysController } from './payment-gateways.controller.js';
import { PaymentGatewaysService } from './payment-gateways.service.js';
import { StripeAccountController } from './stripe-account.controller.js';
import { StripeAccountService } from './stripe-account.service.js';
import { ZohoConnectController } from './zoho-connect.controller.js';
import { ZohoPullService } from './zoho-pull.service.js';
import { ZohoSyncService } from './zoho-sync.service.js';

@Module({
  imports: [AccountingModule],
  controllers: [ZohoConnectController, StripeAccountController, PaymentGatewaysController],
  providers: [
    IntegrationConnectionService,
    ZohoSyncService,
    ZohoPullService,
    StripeAccountService,
    PaymentGatewaysService,
  ],
  exports: [IntegrationConnectionService, ZohoSyncService, ZohoPullService, StripeAccountService],
})
export class IntegrationsModule {}
