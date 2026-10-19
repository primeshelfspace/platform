import { describe, expect, it } from 'vitest';
import { checkBusinessEmail, normalizeWebsiteDomain } from './company-domain.js';

describe('normalizeWebsiteDomain', () => {
  it('strips scheme, www., path and casing to a bare domain', () => {
    expect(normalizeWebsiteDomain('acme.com')).toBe('acme.com');
    expect(normalizeWebsiteDomain('https://acme.com')).toBe('acme.com');
    expect(normalizeWebsiteDomain('http://www.Acme.com/')).toBe('acme.com');
    expect(normalizeWebsiteDomain('https://ACME.COM/about/')).toBe('acme.com');
    expect(normalizeWebsiteDomain('  acme.com  ')).toBe('acme.com');
  });

  it('rejects input that is not a domain', () => {
    expect(normalizeWebsiteDomain('not a domain')).toBeNull();
    expect(normalizeWebsiteDomain('')).toBeNull();
    expect(normalizeWebsiteDomain('acme')).toBeNull();
  });
});

describe('checkBusinessEmail', () => {
  it('accepts an email matching the registered company domain', () => {
    expect(checkBusinessEmail('john@acme.com', 'acme.com').ok).toBe(true);
  });

  it('is case-insensitive when comparing domains', () => {
    expect(checkBusinessEmail('John@ACME.com', 'acme.com').ok).toBe(true);
  });

  it('accepts a subdomain of the registered domain', () => {
    expect(checkBusinessEmail('john@mail.acme.com', 'acme.com').ok).toBe(true);
  });

  it('rejects an email from a different company domain', () => {
    const result = checkBusinessEmail('john@anothercompany.com', 'acme.com');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('DOMAIN_MISMATCH');
  });

  it('rejects free/personal providers when no website is on file', () => {
    for (const email of [
      'john@gmail.com',
      'john@yahoo.com',
      'john@outlook.com',
      'john@hotmail.com',
    ]) {
      const result = checkBusinessEmail(email, null);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('FREE_PROVIDER');
    }
  });

  it('accepts a non-free domain when no website is on file', () => {
    expect(checkBusinessEmail('john@acme.com', null).ok).toBe(true);
  });

  it('rejects malformed email input', () => {
    expect(checkBusinessEmail('not-an-email', 'acme.com').ok).toBe(false);
  });
});
