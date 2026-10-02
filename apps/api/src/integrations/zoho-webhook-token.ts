import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';

/**
 * Per-organization webhook token for Zoho → platform webhooks.
 *
 * Zoho Books signs nothing, so the token in the webhook URL is the only
 * credential. It is derived — HMAC of the organization id under a server
 * secret — rather than stored, so:
 *
 *  - nothing has to be configured before webhooks work: it falls back to
 *    SESSION_SECRET (always set) when ZOHO_WEBHOOK_SECRET is not, which is
 *    exactly the deployment state that silently rejected every webhook before;
 *  - it survives a Zoho reconnect, which rewrites IntegrationConnection.config;
 *  - one merchant seeing their own org's token (the admin setup panel shows
 *    it) learns nothing usable against any other organization.
 *
 * Rotating ZOHO_WEBHOOK_SECRET (or SESSION_SECRET when that is the key)
 * changes every derived token, and every webhook URL in Zoho has to be
 * re-copied from the setup panel.
 */
export function zohoWebhookToken(env: Env, organizationId: string): string {
  const key = env.ZOHO_WEBHOOK_SECRET || env.SESSION_SECRET;
  return createHmac('sha256', key)
    .update(`zoho-webhook:${organizationId}`)
    .digest('hex')
    .slice(0, 40);
}

/** Accepts the per-organization token, or the shared ZOHO_WEBHOOK_SECRET
 * itself so webhooks registered before per-organization tokens existed keep
 * working. */
export function isValidZohoWebhookToken(
  env: Env,
  organizationId: string,
  token: string | undefined,
): boolean {
  if (!token) return false;
  if (safeEqual(token, zohoWebhookToken(env, organizationId))) return true;
  return Boolean(env.ZOHO_WEBHOOK_SECRET) && safeEqual(token, env.ZOHO_WEBHOOK_SECRET!);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
