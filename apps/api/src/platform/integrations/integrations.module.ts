import { Module } from '@nestjs/common';
import { AccountingModule } from '../../adapters/accounting/accounting.module.js';
import { AuthorizeNetAccountController } from './authorize-net-account.controller.js';
import { AuthorizeNetAccountService } from './authorize-net-account.service.js';
import { IntegrationConnectionService } from './integration-connection.service.js';
import { PaymentGatewaysController } from './payment-gateways.controller.js';
import { PaymentGatewaysService } from './payment-gateways.service.js';
import { SquareAccountController } from './square-account.controller.js';
import { SquareAccountService } from './square-account.service.js';
import { StripeAccountController } from './stripe-account.controller.js';
import { StripeAccountService } from './stripe-account.service.js';

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
