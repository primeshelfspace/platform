/**
 * ZohoWebhookController — the transport concerns only (token check, event/
 * organization_id extraction, body-shape tolerance, status mapping).
 * ZohoWebhookService's own routing decisions are covered by
 * zoho-webhook.service.test.ts against a real database; here the service is
 * hand-mocked, matching the style already used for ZohoConnectController.
 */
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Env } from '../config/env.js';
import type { ZohoWebhookService } from './zoho-webhook.service.js';
import { ZohoWebhookController } from './zoho-webhook.controller.js';
import { zohoWebhookToken } from './zoho-webhook-token.js';

const SECRET = 'test-webhook-secret';
const SESSION_SECRET = 'test-session-secret-0000000000000000000000';
const ENV_FOR_TOKENS = {
  ZOHO_WEBHOOK_SECRET: SECRET,
  SESSION_SECRET,
} as unknown as Env;

function makeController(overrides: { webhooks?: Partial<ZohoWebhookService> } = {}) {
  const env = ENV_FOR_TOKENS;
  const webhooks = {
    handleContactEvent: vi.fn().mockResolvedValue({ status: 200 }),
    handleInvoiceEvent: vi.fn().mockResolvedValue({ status: 200 }),
    ...overrides.webhooks,
  } as unknown as ZohoWebhookService;
  const controller = new ZohoWebhookController(env, webhooks);
  return { controller, webhooks };
}

describe('ZohoWebhookController.contacts', () => {
  it('rejects a request with no token, before touching the service at all', async () => {
    const { controller, webhooks } = makeController();

    await expect(
      controller.contacts('created', 'org-1', undefined, { contact: { contact_id: 'c1' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(webhooks.handleContactEvent).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong token', async () => {
    const { controller } = makeController();

    await expect(
      controller.contacts('created', 'org-1', 'wrong-secret', { contact: { contact_id: 'c1' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts the organization's own derived token, and rejects another organization's", async () => {
    const { controller, webhooks } = makeController();
    const body = { contact: { contact_id: 'c1' } };

    await controller.contacts(undefined, 'org-1', zohoWebhookToken(ENV_FOR_TOKENS, 'org-1'), body);
    expect(webhooks.handleContactEvent).toHaveBeenCalledWith('unspecified', 'org-1', 'c1', body);

    await expect(
      controller.contacts(undefined, 'org-1', zohoWebhookToken(ENV_FOR_TOKENS, 'org-2'), body),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('works with no ZOHO_WEBHOOK_SECRET configured at all (token derived from SESSION_SECRET)', async () => {
    const env = { SESSION_SECRET: SESSION_SECRET } as unknown as Env;
    const webhooks = {
      handleContactEvent: vi.fn().mockResolvedValue({ status: 200 }),
    } as unknown as ZohoWebhookService;
    const controller = new ZohoWebhookController(env, webhooks);

    await controller.contacts(undefined, 'org-1', zohoWebhookToken(env, 'org-1'), {
      contact_id: 'c1',
    });
    expect(webhooks.handleContactEvent).toHaveBeenCalled();
  });

  it('accepts the token from the X-Zoho-Webhook-Token header instead of the URL', async () => {
    const { controller, webhooks } = makeController();

    await controller.contacts('created', 'org-1', undefined, { contact_id: 'c1' }, SECRET);
    expect(webhooks.handleContactEvent).toHaveBeenCalled();
  });

  it('reads a form post that carries the entity JSON-encoded under JSONString', async () => {
    const { controller, webhooks } = makeController();
    const body = { JSONString: JSON.stringify({ contact: { contact_id: 'c1' } }) };

    await controller.contacts('created', 'org-1', SECRET, body);
    expect(webhooks.handleContactEvent).toHaveBeenCalledWith('created', 'org-1', 'c1', {
      contact: { contact_id: 'c1' },
    });
  });

  it('reads a raw JSON body delivered as text/plain', async () => {
    const { controller, webhooks } = makeController();

    await controller.contacts('created', 'org-1', SECRET, '{"contact":{"contact_id":"c1"}}');
    expect(webhooks.handleContactEvent).toHaveBeenCalledWith('created', 'org-1', 'c1', {
      contact: { contact_id: 'c1' },
    });
  });

  it('maps event aliases, and treats a missing event as unspecified', async () => {
    const { controller, webhooks } = makeController();
    const body = { contact_id: 'c1' };

    await controller.contacts('edited', 'org-1', SECRET, body);
    await controller.contacts(undefined, 'org-1', SECRET, body);
    expect(vi.mocked(webhooks.handleContactEvent).mock.calls.map((c) => c[0])).toEqual([
      'status_updated',
      'unspecified',
    ]);
  });

  it('rejects an unknown event value', async () => {
    const { controller } = makeController();

    await expect(
      controller.contacts('deleted', 'org-1', SECRET, { contact: { contact_id: 'c1' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a request missing organization_id', async () => {
    const { controller } = makeController();

    await expect(
      controller.contacts('created', undefined, SECRET, { contact: { contact_id: 'c1' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads contact_id from a {contact:{...}} envelope, and forwards the raw body as payload', async () => {
    const { controller, webhooks } = makeController();
    const body = { contact: { contact_id: 'c1' } };

    await controller.contacts('created', 'org-1', SECRET, body);

    expect(webhooks.handleContactEvent).toHaveBeenCalledWith('created', 'org-1', 'c1', body);
  });

  it('also accepts a bare object with no {contact:...} envelope', async () => {
    const { controller, webhooks } = makeController();
    const body = { contact_id: 'c1' };

    await controller.contacts('created', 'org-1', SECRET, body);

    expect(webhooks.handleContactEvent).toHaveBeenCalledWith('created', 'org-1', 'c1', body);
  });

  it('rejects a body with no contact_id at all', async () => {
    const { controller } = makeController();

    await expect(controller.contacts('created', 'org-1', SECRET, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('answers 200 when the service handles the event', async () => {
    const { controller } = makeController();

    const result = await controller.contacts('status_updated', 'org-1', SECRET, {
      contact: { contact_id: 'c1' },
    });

    expect(result).toEqual({ received: true });
  });

  it("surfaces the service's 404 (unresolvable organization) as a real 404, not a 200", async () => {
    const { controller } = makeController({
      webhooks: { handleContactEvent: vi.fn().mockResolvedValue({ status: 404 }) },
    });

    await expect(
      controller.contacts('created', 'org-unknown', SECRET, { contact: { contact_id: 'c1' } }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ZohoWebhookController.invoices', () => {
  it('reads invoice_id from a {invoice:{...}} envelope and forwards event/org/payload', async () => {
    const { controller, webhooks } = makeController();
    const body = { invoice: { invoice_id: 'i1' } };

    await controller.invoices('created', 'org-1', SECRET, body);

    expect(webhooks.handleInvoiceEvent).toHaveBeenCalledWith('created', 'org-1', 'i1', body);
  });

  it("surfaces the service's 404 as a real 404", async () => {
    const { controller } = makeController({
      webhooks: { handleInvoiceEvent: vi.fn().mockResolvedValue({ status: 404 }) },
    });

    await expect(
      controller.invoices('created', 'org-unknown', SECRET, { invoice: { invoice_id: 'i1' } }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
