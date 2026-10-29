/**
 * The validation every onboarding form gets before anything is written
 * (docs/product/stories/company-onboarding.md): each field's rule, and the
 * message the screen shows for it.
 */
import { describe, expect, it } from 'vitest';
import { enableProductsSchema } from './products.js';
import { firstBrandSchema, registerCompanySchema, registerSchema } from './schemas.js';

/** The message for one field, or undefined when it passed. */
function errorFor(
  result: { success: boolean; error?: { issues: Array<{ path: unknown[]; message: string }> } },
  field: string,
) {
  return result.success
    ? undefined
    : result.error!.issues.find((i) => i.path[0] === field)?.message;
}

describe('Sign Up', () => {
  const valid = { email: 'dana@acme-coffee.com', password: 'a long enough password' };

  it('accepts a company email and a password that meets the rules', () => {
    const parsed = registerSchema.parse({ ...valid, email: '  Dana@Acme-Coffee.com ' });
    expect(parsed.email).toBe('dana@acme-coffee.com');
  });

  it('shows an error for a missing email or password', () => {
    expect(errorFor(registerSchema.safeParse({ password: valid.password }), 'email')).toBe(
      'email is required',
    );
    expect(errorFor(registerSchema.safeParse({ ...valid, email: '' }), 'email')).toBe(
      'email is required',
    );
    expect(errorFor(registerSchema.safeParse({ email: valid.email }), 'password')).toBe(
      'password is required',
    );
  });

  it('shows an error for an email that is not a valid address', () => {
    for (const email of ['dana', 'dana@', '@acme.com', 'dana@acme']) {
      expect(errorFor(registerSchema.safeParse({ ...valid, email }), 'email')).toBeDefined();
    }
  });

  it('says a company email is required for a personal one', () => {
    for (const email of ['dana@gmail.com', 'dana@outlook.com', 'dana@yahoo.com']) {
      expect(errorFor(registerSchema.safeParse({ ...valid, email }), 'email')).toBe(
        'use your company email address, not a personal email provider',
      );
    }
  });

  it('shows an error for a password that does not meet the rules', () => {
    expect(errorFor(registerSchema.safeParse({ ...valid, password: 'short' }), 'password')).toBe(
      'use at least 12 characters',
    );
    expect(
      errorFor(registerSchema.safeParse({ ...valid, password: 'x'.repeat(201) }), 'password'),
    ).toBeDefined();
  });
});

describe('Register Your Company', () => {
  const valid = {
    companyName: 'Acme Coffee',
    legalName: 'Acme Coffee LLC',
    taxId: '12-3456789',
    brandStructure: 'SINGLE',
  };

  it('accepts every field, with one space between words in the name', () => {
    expect(registerCompanySchema.parse({ ...valid, companyName: '  Acme    Coffee ' })).toEqual({
      ...valid,
      companyName: 'Acme Coffee',
    });
  });

  it('accepts either brand structure', () => {
    expect(registerCompanySchema.safeParse({ ...valid, brandStructure: 'MULTI' }).success).toBe(
      true,
    );
  });

  it('shows an error for each missing field', () => {
    for (const field of ['companyName', 'legalName', 'taxId', 'brandStructure']) {
      const { [field]: _left, ...rest } = valid as Record<string, string>;
      expect(errorFor(registerCompanySchema.safeParse(rest), field)).toBeDefined();
      expect(
        errorFor(registerCompanySchema.safeParse({ ...valid, [field]: '   ' }), field),
      ).toBeDefined();
    }
  });

  it('refuses a tax ID with characters a tax ID cannot have', () => {
    expect(errorFor(registerCompanySchema.safeParse({ ...valid, taxId: '12;DROP' }), 'taxId')).toBe(
      'a tax ID may contain only letters, digits, spaces and - . /',
    );
    expect(registerCompanySchema.safeParse({ ...valid, taxId: 'GB 123.456/78' }).success).toBe(
      true,
    );
  });

  it('refuses a brand structure that is neither choice', () => {
    expect(
      errorFor(
        registerCompanySchema.safeParse({ ...valid, brandStructure: 'MANY' }),
        'brandStructure',
      ),
    ).toBe('choose single brand or multiple brands');
  });
});

describe('Add Your Brand', () => {
  const valid = {
    legalName: 'Acme Coffee LLC',
    displayName: 'Acme Coffee',
    currency: 'USD',
    timezone: 'America/New_York',
  };

  it('accepts the four required details, with or without a theme colour', () => {
    expect(firstBrandSchema.parse(valid)).toEqual(valid);
    expect(firstBrandSchema.parse({ ...valid, themeColor: 'aa3366' }).themeColor).toBe('#AA3366');
    expect(firstBrandSchema.parse({ ...valid, themeColor: null }).themeColor).toBeNull();
  });

  it('shows an error for each missing detail', () => {
    for (const field of ['legalName', 'displayName', 'currency', 'timezone']) {
      const { [field]: _left, ...rest } = valid as Record<string, string>;
      expect(errorFor(firstBrandSchema.safeParse(rest), field)).toBeDefined();
      expect(errorFor(firstBrandSchema.safeParse({ ...valid, [field]: '' }), field)).toBeDefined();
    }
  });

  it('shows an error for a currency that is not supported', () => {
    expect(
      errorFor(firstBrandSchema.safeParse({ ...valid, currency: 'XYZ' }), 'currency'),
    ).toBeDefined();
    expect(firstBrandSchema.parse({ ...valid, currency: 'eur' }).currency).toBe('EUR');
  });

  it('shows an error for a time zone that does not exist', () => {
    for (const timezone of ['America/Atlantis', 'Mars/Olympus', 'EST5', 'nowhere']) {
      expect(errorFor(firstBrandSchema.safeParse({ ...valid, timezone }), 'timezone')).toBe(
        'enter a valid time zone, e.g. America/New_York',
      );
    }
    for (const timezone of ['Asia/Karachi', 'Europe/London', 'UTC']) {
      expect(firstBrandSchema.safeParse({ ...valid, timezone }).success).toBe(true);
    }
  });

  it('shows an error for a theme colour that is not a hex colour', () => {
    expect(
      errorFor(firstBrandSchema.safeParse({ ...valid, themeColor: 'teal' }), 'themeColor'),
    ).toBeDefined();
  });
});

describe('Select Your Products', () => {
  it('needs at least one product, each once', () => {
    expect(enableProductsSchema.safeParse({ products: ['INVOICING'] }).success).toBe(true);
    expect(enableProductsSchema.safeParse({ products: ['INVOICING', 'HQ'] }).success).toBe(true);
    expect(errorFor(enableProductsSchema.safeParse({ products: [] }), 'products')).toBe(
      'select at least one product',
    );
    expect(errorFor(enableProductsSchema.safeParse({}), 'products')).toBe(
      'select at least one product',
    );
    expect(errorFor(enableProductsSchema.safeParse({ products: ['HQ', 'HQ'] }), 'products')).toBe(
      'a product is listed twice',
    );
    expect(enableProductsSchema.safeParse({ products: ['PAYROLL'] }).success).toBe(false);
  });
});
