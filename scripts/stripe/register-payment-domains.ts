/**
 * Registers the payment page's website (the host of PAYMENT_PUBLIC_URL, e.g.
 * www.sugrpay.com) with every brand's connected Stripe account, so Apple Pay
 * and Google Pay can appear on its payment page. New connections do this
 * themselves (StripeAccountService.completeConnection); run this once for
 * brands connected before that, or after changing the payment page's domain.
 * Safe to repeat.
 *
 *   pnpm stripe:register-payment-domains
 */
import Stripe from 'stripe';
import { PrismaClient } from '../../apps/platform/generated/index.js';

const STRIPE_API_VERSION = '2025-02-24.acacia';

async function main(): Promise<void> {
  const secret = process.env['STRIPE_SECRET_KEY'];
  const paymentUrl = process.env['PAYMENT_PUBLIC_URL'];
  if (!secret || !paymentUrl)
    throw new Error('STRIPE_SECRET_KEY and PAYMENT_PUBLIC_URL are required');
  const domain = new URL(paymentUrl).hostname;
  const stripe = new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
  const db = new PrismaClient({
    datasources: {
      db: {
        url: process.env['PLATFORM_DIRECT_DATABASE_URL'] ?? process.env['PLATFORM_DATABASE_URL'],
      },
    },
  });

  const rows = await db.integrationConnection.findMany({
    where: { provider: 'STRIPE', status: 'CONNECTED' },
    select: { brandId: true, config: true },
  });
  let done = 0;
  for (const row of rows) {
    const accountId = (row.config as { accountId?: string } | null)?.accountId;
    if (!accountId) continue;
    try {
      const existing = await stripe.paymentMethodDomains.list(
        { domain_name: domain, limit: 1 },
        { stripeAccount: accountId },
      );
      const found = existing.data[0];
      if (!found) {
        await stripe.paymentMethodDomains.create(
          { domain_name: domain, enabled: true },
          { stripeAccount: accountId },
        );
      } else if (!found.enabled) {
        await stripe.paymentMethodDomains.update(
          found.id,
          { enabled: true },
          { stripeAccount: accountId },
        );
      }
      done++;
      console.log(`brand ${row.brandId} (${accountId}): ${domain} registered`);
    } catch (error) {
      console.error(
        `brand ${row.brandId} (${accountId}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  console.log(`${done} of ${rows.length} connected Stripe accounts have ${domain} registered.`);
  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
