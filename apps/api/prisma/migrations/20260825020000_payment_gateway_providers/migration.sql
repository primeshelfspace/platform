-- Brand Settings → Payment Gateways now offers PayPal, Square and
-- Authorize.net alongside Stripe. None of the three has a credential
-- handshake behind it yet (PaymentGatewaysService.connectManual) — they
-- reuse the same IntegrationConnection row shape STRIPE and ZOHO_BOOKS
-- already use, just without encryptedCredentials or config ever being set.
ALTER TYPE "IntegrationProvider" ADD VALUE 'PAYPAL';
ALTER TYPE "IntegrationProvider" ADD VALUE 'SQUARE';
ALTER TYPE "IntegrationProvider" ADD VALUE 'AUTHORIZE_NET';
