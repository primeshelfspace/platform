import { describe, expect, it } from 'vitest';
import { apiServiceFor } from './api-routing.js';

const BRAND = '3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60';

describe('apiServiceFor', () => {
  it('sends invoicing work to Sugrpay', () => {
    for (const path of [
      `/brands/${BRAND}/invoices`,
      `/brands/${BRAND}/invoices/x/issue`,
      `/brands/${BRAND}/customers?page=1`,
      `/brands/${BRAND}/checks`,
      `/brands/${BRAND}/payments?page=1`,
      `/brands/${BRAND}/settings/payment-methods`,
      `/brands/${BRAND}/integrations/zoho/status`,
      '/dashboard/summary?brandId=x',
      '/public/invoices/abc/payment-intents',
      '/public/webhooks/stripe',
      '/integrations/zoho/callback?code=1',
      '/webhooks/zoho/contacts',
      '/health/queues',
    ]) {
      expect(apiServiceFor(path), path).toBe('sugrpay');
    }
  });

  it('sends everything else to the platform', () => {
    for (const path of [
      '/auth/login',
      '/auth/me',
      '/users/invite',
      '/brands',
      `/brands/${BRAND}`,
      `/brands/${BRAND}/logo`,
      `/brands/${BRAND}/integrations/stripe/connect`,
      `/brands/${BRAND}/integrations/gateways`,
      '/integrations/stripe/callback',
      '/merchant/onboarding',
      '/company/subscriptions',
      '/locations',
      '/health',
    ]) {
      expect(apiServiceFor(path), path).toBe('platform');
    }
  });

  it('is not fooled by a look-alike path', () => {
    expect(apiServiceFor('/dashboards')).toBe('platform');
    expect(apiServiceFor(`/brands/${BRAND}/invoicesX`)).toBe('platform');
    expect(apiServiceFor('/publication')).toBe('platform');
  });
});
