/**
 * The validation the product company APIs get before anything is written
 * (docs/product/stories/product-company-apis.md): Brand Management's details
 * (the same schema as Add Your Brand, tested in onboarding-schemas.test.ts)
 * and User Management's. Phone-for-country, role-for-product and
 * Brand-in-Company are checked by the API against data, not here.
 */
import { describe, expect, it } from 'vitest';
import {
  firstBrandSchema,
  productUserEditSchema,
  productUserListQuerySchema,
  productUserSchema,
} from './schemas.js';

function errorFor(
  result: { success: boolean; error?: { issues: Array<{ path: unknown[]; message: string }> } },
  field: string,
) {
  return result.success
    ? undefined
    : result.error!.issues.find((i) => i.path[0] === field)?.message;
}

const validUser = {
  name: 'Riley Stone',
  email: 'riley@acme-coffee.com',
  phone: { country: 'us', number: '(202) 555-0143' },
  password: 'a long enough password',
  role: 'MANAGER',
  brandIds: ['5b0c7a1e-1f7a-4c1e-9a43-8a0f2b7d6c11'],
};

describe('User Management: add a user', () => {
  it('accepts every detail, with the country upper-cased and the email normalised', () => {
    const parsed = productUserSchema.parse({ ...validUser, email: ' Riley@Acme-Coffee.com ' });
    expect(parsed.phone.country).toBe('US');
    expect(parsed.email).toBe('riley@acme-coffee.com');
  });

  it('shows an error for each missing detail', () => {
    for (const field of ['name', 'email', 'phone', 'password', 'role', 'brandIds'] as const) {
      const { [field]: _left, ...rest } = validUser;
      expect(errorFor(productUserSchema.safeParse(rest), field)).toBeDefined();
    }
  });

  it('refuses no Brand at all', () => {
    expect(errorFor(productUserSchema.safeParse({ ...validUser, brandIds: [] }), 'brandIds')).toBe(
      'choose at least one Brand',
    );
  });

  it('refuses an email that is not an email address', () => {
    expect(
      errorFor(productUserSchema.safeParse({ ...validUser, email: 'not-an-email' }), 'email'),
    ).toBeDefined();
  });

  it('refuses a password that does not meet the rules', () => {
    expect(
      errorFor(productUserSchema.safeParse({ ...validUser, password: 'short' }), 'password'),
    ).toBe('use at least 12 characters');
  });

  it('refuses a phone without a 2-letter country', () => {
    const result = productUserSchema.safeParse({
      ...validUser,
      phone: { country: '+1', number: '2025550143' },
    });
    expect(errorFor(result, 'phone')).toBe('country must be a 2-letter country code, e.g. US');
  });
});

describe('User Management: edit a user', () => {
  it('takes the same details without a password, and refuses removing one', () => {
    const { password: _password, ...edit } = validUser;
    expect(productUserEditSchema.parse(edit).name).toBe('Riley Stone');
    expect(errorFor(productUserEditSchema.safeParse({ ...edit, name: '  ' }), 'name')).toBe(
      'name is required',
    );
    expect(errorFor(productUserEditSchema.safeParse({ ...edit, brandIds: [] }), 'brandIds')).toBe(
      'choose at least one Brand',
    );
  });
});

describe('User List', () => {
  it('takes an optional Brand, which must be an id', () => {
    expect(productUserListQuerySchema.parse({})).toEqual({});
    expect(productUserListQuerySchema.safeParse({ brandId: 'nope' }).success).toBe(false);
  });
});

describe('Brand Management', () => {
  it('refuses a missing required detail or an invalid currency or time zone', () => {
    const brand = {
      legalName: 'Acme LLC',
      displayName: 'Acme',
      currency: 'USD',
      timezone: 'America/Chicago',
    };
    for (const field of ['legalName', 'displayName', 'currency', 'timezone'] as const) {
      expect(errorFor(firstBrandSchema.safeParse({ ...brand, [field]: '' }), field)).toBeDefined();
    }
    expect(firstBrandSchema.safeParse({ ...brand, currency: 'XXX' }).success).toBe(false);
    expect(firstBrandSchema.safeParse({ ...brand, timezone: 'Mars/Base' }).success).toBe(false);
  });
});
