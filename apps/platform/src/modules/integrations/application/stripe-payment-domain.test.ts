/**
 * Apple Pay / Google Pay need the payment page's website registered with the
 * Stripe account taking the payment (the brand's connected account). Stripe
 * itself is faked: what matters is which calls are made, on which account.
 */
import type { Env } from '@platform/server';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { StripeAccountService } from './stripe-account.service.js';

function serviceWith(
  existing: { id: string; enabled: boolean } | null,
  paymentUrl = 'https://www.sugrpay.com/pay',
) {
  const domains = {
    list: vi.fn(async () => ({ data: existing ? [existing] : [] })),
    create: vi.fn(async () => ({ id: 'pmd_new' })),
    update: vi.fn(async () => ({ id: existing?.id })),
  };
  const service = new StripeAccountService(
    {} as PlatformPrismaService,
    { PAYMENT_PUBLIC_URL: paymentUrl, STRIPE_SECRET_KEY: 'sk_test_x' } as Env,
  );
  vi.spyOn(service, 'platformClient').mockReturnValue({
    paymentMethodDomains: domains,
  } as never);
  return { service, domains };
}

describe('StripeAccountService.registerPaymentDomain', () => {
  it('registers the payment page host on the connected account', async () => {
    const { service, domains } = serviceWith(null);
    await expect(service.registerPaymentDomain('acct_123')).resolves.toBe(true);
    expect(domains.create).toHaveBeenCalledWith(
      { domain_name: 'www.sugrpay.com', enabled: true },
      { stripeAccount: 'acct_123' },
    );
  });

  it('re-enables a domain that is registered but switched off, and leaves an enabled one alone', async () => {
    const off = serviceWith({ id: 'pmd_1', enabled: false });
    await off.service.registerPaymentDomain('acct_123');
    expect(off.domains.update).toHaveBeenCalledWith(
      'pmd_1',
      { enabled: true },
      { stripeAccount: 'acct_123' },
    );
    expect(off.domains.create).not.toHaveBeenCalled();

    const on = serviceWith({ id: 'pmd_2', enabled: true });
    await on.service.registerPaymentDomain('acct_123');
    expect(on.domains.update).not.toHaveBeenCalled();
    expect(on.domains.create).not.toHaveBeenCalled();
  });

  it('skips localhost, and never throws when Stripe refuses', async () => {
    const local = serviceWith(null, 'http://localhost:3000/pay');
    await expect(local.service.registerPaymentDomain('acct_123')).resolves.toBe(false);
    expect(local.domains.list).not.toHaveBeenCalled();

    const failing = serviceWith(null);
    failing.domains.create.mockRejectedValueOnce(new Error('Stripe is down'));
    await expect(failing.service.registerPaymentDomain('acct_123')).resolves.toBe(false);
  });
});
