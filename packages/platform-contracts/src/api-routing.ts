/**
 * Which API serves a path. There are three APIs, each its own program with
 * its own address: the platform (sign-in, companies, brands, users, …),
 * Sugrpay (invoicing) and, later, HQ. A client that talks to more than one —
 * the web app, the end-to-end tests — asks this rather than keeping its own
 * list, and nginx's api.sugrpay.com front door routes by the same rule
 * (deploy/nginx/api.conf).
 */
export type ApiService = 'platform' | 'sugrpay';

/** Sugrpay's paths; everything else is the platform's. */
const SUGRPAY_PATHS = [
  // Signed-in Sugrpay screens.
  /^\/dashboard(\/|$)/,
  /^\/brands\/[^/]+\/(checks|customers|invoices|payments|settings)(\/|$)/,
  /^\/brands\/[^/]+\/integrations\/zoho(\/|$)/,
  // The public payment page, and payment-gateway webhooks.
  /^\/public(\/|$)/,
  // Zoho Books: the OAuth callback and its webhooks.
  /^\/integrations\/zoho(\/|$)/,
  /^\/webhooks\/zoho(\/|$)/,
  // Background-job queue depths (Sugrpay runs every job).
  /^\/health\/queues(\/|$)/,
];

export function apiServiceFor(path: string): ApiService {
  const pathname = path.split('?')[0] ?? path;
  return SUGRPAY_PATHS.some((pattern) => pattern.test(pathname)) ? 'sugrpay' : 'platform';
}
