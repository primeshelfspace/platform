import { Module } from '@nestjs/common';
import { AccountingModule } from '../adapters/accounting/accounting.module.js';
import { AuthorizeNetAccountController } from './authorize-net-account.controller.js';
import { AuthorizeNetAccountService } from './authorize-net-account.service.js';
import { IntegrationConnectionService } from './integration-connection.service.js';
import { PaymentGatewaysController } from './payment-gateways.controller.js';
import { PaymentGatewaysService } from './payment-gateways.service.js';
import { SquareAccountController } from './square-account.controller.js';
import { SquareAccountService } from './square-account.service.js';
import { StripeAccountController } from './stripe-account.controller.js';
import { StripeAccountService } from './stripe-account.service.js';
import { ZohoConnectController } from './zoho-connect.controller.js';
import { ZohoPullService } from './zoho-pull.service.js';
import { ZohoSandboxController } from './zoho-sandbox.controller.js';
import { ZohoSandboxService } from './zoho-sandbox.service.js';
import { ZohoSyncService } from './zoho-sync.service.js';
import { ZohoWebhookController } from './zoho-webhook.controller.js';
import { ZohoWebhookService } from './zoho-webhook.service.js';

@Module({
  imports: [AccountingModule],
  controllers: [
    ZohoConnectController,
    ZohoWebhookController,
    ZohoSandboxController,
    StripeAccountController,
    SquareAccountController,
    AuthorizeNetAccountController,
    PaymentGatewaysController,
  ],
  providers: [
    IntegrationConnectionService,
    ZohoSyncService,
    ZohoPullService,
    ZohoWebhookService,
    ZohoSandboxService,
    StripeAccountService,
    SquareAccountService,
    AuthorizeNetAccountService,
    PaymentGatewaysService,
  ],
  exports: [
    IntegrationConnectionService,
    ZohoSyncService,
    ZohoPullService,
    ZohoWebhookService,
    ZohoSandboxService,
    StripeAccountService,
    SquareAccountService,
    AuthorizeNetAccountService,
  ],
})
export class IntegrationsModule {}
