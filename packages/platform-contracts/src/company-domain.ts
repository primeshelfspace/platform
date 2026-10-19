/**
 * Business-email and company-website domain rules for Company Details
 * (FR-ONB). A company's own registered domain — not a fixed blacklist — is
 * the primary signal that an email belongs to the business: the blacklist
 * below only matters as a fallback, for the common personal providers people
 * reach for, when no website has been given yet to check the email against.
 */

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Free/personal email providers rejected only when there is no registered
 * company domain to validate against instead — see checkBusinessEmail. Not
 * exhaustive by design; it exists to catch the obvious cases the primary,
 * domain-match check can't (there being no domain yet to compare to). */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'zoho.com',
  'aim.com',
  'inbox.com',
]);

/**
 * Normalizes a company website into a bare registrable-looking host:
 * strips any scheme, a leading `www.`, path/query/fragment, a trailing
 * dot, and a port, then lowercases. Returns null if what's left doesn't
 * look like a domain. `https://Acme.com/about/` and `acme.com` both
 * normalize to `acme.com`, so differing formatting never causes a false
 * mismatch against the business email domain.
 */
export function normalizeWebsiteDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/)[0] ?? '';
  value = value.replace(/^www\./, '');
  value = value.replace(/:\d+$/, '');
  value = value.replace(/\.$/, '');

  return DOMAIN_PATTERN.test(value) ? value : null;
}

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1 || at === email.length - 1) return null;
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

/** A subdomain of the registered domain is accepted — `john@mail.acme.com`
 * counts as belonging to `acme.com` — since the same organisation almost
 * always controls its own subdomains, and a corporate mail provider hosted
 * on one is a common, legitimate setup. */
function domainMatchesWebsite(candidate: string, registeredDomain: string): boolean {
  return candidate === registeredDomain || candidate.endsWith(`.${registeredDomain}`);
}

export type BusinessEmailRejection = 'FORMAT' | 'FREE_PROVIDER' | 'DOMAIN_MISMATCH';

export interface BusinessEmailCheck {
  readonly ok: boolean;
  readonly reason?: BusinessEmailRejection;
}

/**
 * Checks a business email against the company's registered website domain
 * when one is known, normalizing both sides first for a case- and
 * formatting-insensitive comparison. Without a website on file, falls back
 * to rejecting known free/personal providers only — the weaker signal used
 * when there is nothing more specific to compare against.
 */
export function checkBusinessEmail(
  email: string,
  websiteDomain: string | null,
): BusinessEmailCheck {
  const domain = emailDomain(email);
  if (!domain) return { ok: false, reason: 'FORMAT' };

  if (websiteDomain) {
    return domainMatchesWebsite(domain, websiteDomain)
      ? { ok: true }
      : { ok: false, reason: 'DOMAIN_MISMATCH' };
  }

  return FREE_EMAIL_DOMAINS.has(domain) ? { ok: false, reason: 'FREE_PROVIDER' } : { ok: true };
}
