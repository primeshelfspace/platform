import { describe, expect, it } from 'vitest';
import { companyDetailsSchema } from './entities.js';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    legalName: 'Acme Inc',
    dba: null,
    businessType: 'LLC',
    phone: '(212) 555-1234',
    email: 'john@acme.com',
    website: 'acme.com',
    mailingAddress: {
      line1: '123 Main St',
      line2: null,
      city: 'New York',
      region: 'NY',
      postalCode: '10001',
      country: 'US',
    },
    billingAddress: null,
    taxId: null,
    ...overrides,
  };
}

describe('companyDetailsSchema', () => {
  it('accepts a fully valid US company', () => {
    const result = companyDetailsSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe('+12125551234');
      expect(result.data.website).toBe('acme.com');
    }
  });

  it('normalizes phone and website formatting variance', () => {
    const result = companyDetailsSchema.safeParse(
      baseInput({ phone: '+1 212 555 1234', website: 'https://www.Acme.com/' }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe('+12125551234');
      expect(result.data.website).toBe('acme.com');
    }
  });

  describe('ZIP code', () => {
    it.each(['12345', '12345-6789'])('accepts %s', (postalCode) => {
      const result = companyDetailsSchema.safeParse(
        baseInput({ mailingAddress: { ...baseInput().mailingAddress, postalCode } }),
      );
      expect(result.success).toBe(true);
    });

    it.each(['1234', '123456', 'ABCDE'])('rejects %s', (postalCode) => {
      const result = companyDetailsSchema.safeParse(
        baseInput({ mailingAddress: { ...baseInput().mailingAddress, postalCode } }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe('phone', () => {
    it('rejects a non-US country code', () => {
      const result = companyDetailsSchema.safeParse(baseInput({ phone: '+44 20 7946 0958' }));
      expect(result.success).toBe(false);
    });

    it('rejects a malformed number', () => {
      const result = companyDetailsSchema.safeParse(baseInput({ phone: '555-1234' }));
      expect(result.success).toBe(false);
    });
  });

  describe('business email', () => {
    it('accepts an email matching the company website domain', () => {
      const result = companyDetailsSchema.safeParse(
        baseInput({ email: 'john@acme.com', website: 'acme.com' }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects a personal provider when no website is given', () => {
      const result = companyDetailsSchema.safeParse(
        baseInput({ email: 'john@gmail.com', website: null }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects an email from a different company domain', () => {
      const result = companyDetailsSchema.safeParse(
        baseInput({ email: 'john@anothercompany.com', website: 'acme.com' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects an invalid email format', () => {
      const result = companyDetailsSchema.safeParse(baseInput({ email: 'not-an-email' }));
      expect(result.success).toBe(false);
    });

    it('is case-insensitive comparing the email domain against the website', () => {
      const result = companyDetailsSchema.safeParse(
        baseInput({ email: 'John@ACME.com', website: 'acme.com' }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('state', () => {
    it('accepts a two-letter US state code', () => {
      const result = companyDetailsSchema.safeParse(
        baseInput({ mailingAddress: { ...baseInput().mailingAddress, region: 'CA' } }),
      );
      expect(result.success).toBe(true);
    });
  });
});
