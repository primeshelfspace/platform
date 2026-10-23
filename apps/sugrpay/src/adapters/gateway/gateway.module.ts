import { Module } from '@nestjs/common';
import { PAYMENT_GATEWAY_PORT } from '@platform/kernel';
import { ENV, type Env } from '@platform/server';
import { FakeGatewayAdapter } from './fake-gateway.adapter.js';
import { NumbersGatewayAdapter } from './numbers-gateway.adapter.js';
import { StripeGatewayAdapter } from './stripe-gateway.adapter.js';

/**
 * Composition point for PaymentGatewayPort. The driver is a configuration
 * value; nothing above this line knows which adapter is bound.
 *
 * is imported for StripeAccountService — StripeGatewayAdapter
 * resolves each brand's own Stripe credentials through it rather than a
 * global env var (multi-tenant Stripe).
 */
@Module({
  imports: [],
  providers: [
    FakeGatewayAdapter,
    NumbersGatewayAdapter,
    StripeGatewayAdapter,
    {
      provide: PAYMENT_GATEWAY_PORT,
      inject: [ENV, FakeGatewayAdapter, NumbersGatewayAdapter, StripeGatewayAdapter],
      useFactory: (
        env: Env,
        fake: FakeGatewayAdapter,
        numbers: NumbersGatewayAdapter,
        stripe: StripeGatewayAdapter,
      ) =>
        env.PAYMENT_GATEWAY_DRIVER === 'stripe'
          ? stripe
          : env.PAYMENT_GATEWAY_DRIVER === 'numbers'
            ? numbers
            : fake,
    },
  ],
  exports: [PAYMENT_GATEWAY_PORT, FakeGatewayAdapter],
})
export class GatewayModule {}
