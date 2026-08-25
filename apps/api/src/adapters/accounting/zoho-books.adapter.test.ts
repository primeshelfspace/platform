/**
 * Pure mapping logic only — no network, no DB. These are exactly the
 * boundary conversions a pull can get subtly wrong: a payment mode mapped
 * to the wrong local enum, a decimal-to-minor rounding error, or an address
 * with no fields treated as "present" instead of null.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountingConnection } from '@fenwick/shared';
import type { Env } from '../../config/env.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import { ZohoBooksAdapter } from './zoho-books.adapter.js';

// None of the methods under test call request() (the only thing that reads
// this), so an empty stub is enough — same reasoning as the {} as Env below.
const adapter = new ZohoBooksAdapter({} as Env, {} as RedisService);

describe('ZohoBooksAdapter.reverseMapPaymentMode', () => {
  it('maps creditcard to CARD', () => {
    expect(adapter.reverseMapPaymentMode('creditcard')).toBe('CARD');
  });

  it('maps banktransfer and bankremittance to ACH', () => {
    expect(adapter.reverseMapPaymentMode('banktransfer')).toBe('ACH');
    expect(adapter.reverseMapPaymentMode('bankremittance')).toBe('ACH');
  });

  it('maps check to CHECK', () => {
    expect(adapter.reverseMapPaymentMode('check')).toBe('CHECK');
  });

  it('maps anything else (cash, paypal, stripe, ...) to MANUAL', () => {
    expect(adapter.reverseMapPaymentMode('cash')).toBe('MANUAL');
    expect(adapter.reverseMapPaymentMode('paypal')).toBe('MANUAL');
    expect(adapter.reverseMapPaymentMode('stripe')).toBe('MANUAL');
    expect(adapter.reverseMapPaymentMode('something_new_zoho_adds_later')).toBe('MANUAL');
  });
});

describe('ZohoBooksAdapter.decimalToMinor', () => {
  it('converts whole and fractional amounts exactly', () => {
    expect(adapter.decimalToMinor(12.34)).toBe(1234);
    expect(adapter.decimalToMinor(0)).toBe(0);
    expect(adapter.decimalToMinor(100)).toBe(10000);
  });

  it('rounds rather than truncates on floating-point-imprecise values', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754 — a naive Math.floor
    // would silently undercharge by a cent.
    expect(adapter.decimalToMinor(19.99)).toBe(1999);
    expect(adapter.decimalToMinor(0.1)).toBe(10);
  });
});

describe('ZohoBooksAdapter.fromZohoAddress', () => {
  it('returns null when Zoho sent no address at all', () => {
    expect(adapter.fromZohoAddress(undefined)).toBeNull();
  });

  it('returns null for an empty address object rather than a blank shell', () => {
    expect(adapter.fromZohoAddress({})).toBeNull();
  });

  it('maps every field to our AccountingAddress shape', () => {
    expect(
      adapter.fromZohoAddress({
        address: '1 Harbour Street',
        street2: 'Suite 4',
        city: 'Boston',
        state: 'MA',
        zip: '02110',
        country: 'US',
      }),
    ).toEqual({
      line1: '1 Harbour Street',
      line2: 'Suite 4',
      city: 'Boston',
      region: 'MA',
      postalCode: '02110',
      country: 'US',
    });
  });

  it('fills missing individual fields with null rather than undefined', () => {
    expect(adapter.fromZohoAddress({ city: 'Boston' })).toEqual({
      line1: null,
      line2: null,
      city: 'Boston',
      region: null,
      postalCode: null,
      country: null,
    });
  });
});

describe('ZohoBooksAdapter.listContactsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The shared `adapter` above has no ZOHO_API_DOMAIN (env is `{}`), which
  // request() needs as the base URL for a real HTTP call — this test is the
  // one in the file that actually issues one (against a stubbed fetch), so
  // it needs a real-shaped env. request() also gates every call through
  // RedisService's rate-limit token bucket (see waitForRateSlot), so unlike
  // the shared `adapter` above, this one needs a real (if stubbed) redis
  // whose acquireRateToken always grants a slot.
  const envAdapter = new ZohoBooksAdapter(
    { ZOHO_API_DOMAIN: 'https://www.zohoapis.com' } as Env,
    { acquireRateToken: vi.fn().mockResolvedValue(true) } as unknown as RedisService,
  );

  const connection: AccountingConnection = {
    brandId: 'brand-1',
    organisationId: 'org-1',
    accessToken: 'tok',
    refreshToken: 'refresh',
    expiresAt: null,
  };

  it('asks Zoho for every contact status, not just active ones — a customer\'s ' +
    'sync-status archiving depends on seeing it even after Zoho deactivates it', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        requestedUrls.push(url.toString());
        return new Response(JSON.stringify({ contacts: [], page_context: { has_more_page: false } }), {
          status: 200,
        });
      }),
    );

    await envAdapter.listContactsPage(connection, 1);

    expect(requestedUrls).toHaveLength(1);
    const url = new URL(requestedUrls[0]!);
    expect(url.pathname).toBe('/books/v3/contacts');
    expect(url.searchParams.get('filter_by')).toBe('Status.All');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('organization_id')).toBe('org-1');
  });
});
