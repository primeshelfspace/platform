import { Module } from '@nestjs/common';
import { AccountingModule } from '../../../shared/adapters/accounting/accounting.module.js';
import { AuthorizeNetAccountController } from './interface/authorize-net-account.controller.js';
import { AuthorizeNetAccountService } from './application/authorize-net-account.service.js';
import { IntegrationConnectionService } from './application/integration-connection.service.js';
import { PaymentGatewaysController } from './interface/payment-gateways.controller.js';
import { PaymentGatewaysService } from './application/payment-gateways.service.js';
import { SquareAccountController } from './interface/square-account.controller.js';
import { SquareAccountService } from './application/square-account.service.js';
import { StripeAccountController } from './interface/stripe-account.controller.js';
import { StripeAccountService } from './application/stripe-account.service.js';

/**
 * Platform integrations: the connection records and their credentials, owned
 * by the platform so every product shares one connection per brand and
 * provider. What a product *does* with a connection (Zoho invoice sync, say)
 * lives in that product's own module.
 */
@Module({
  // IntegrationConnectionService refreshes Zoho OAuth tokens via the adapter.
  imports: [AccountingModule],
  controllers: [
    StripeAccountController,
    SquareAccountController,
    AuthorizeNetAccountController,
    PaymentGatewaysController,
  ],
  providers: [
    IntegrationConnectionService,
    StripeAccountService,
    SquareAccountService,
    AuthorizeNetAccountService,
    PaymentGatewaysService,
  ],
  exports: [
    IntegrationConnectionService,
    StripeAccountService,
    SquareAccountService,
    AuthorizeNetAccountService,
  ],
})
export class IntegrationsModule {}
