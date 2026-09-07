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

const SECRET = 'test-webhook-secret';

function makeController(overrides: { webhooks?: Partial<ZohoWebhookService> } = {}) {
  const env = { ZOHO_WEBHOOK_SECRET: SECRET } as unknown as Env;
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

  it('surfaces the service\'s 404 (unresolvable organization) as a real 404, not a 200', async () => {
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

  it('surfaces the service\'s 404 as a real 404', async () => {
    const { controller } = makeController({
      webhooks: { handleInvoiceEvent: vi.fn().mockResolvedValue({ status: 404 }) },
    });

    await expect(
      controller.invoices('created', 'org-unknown', SECRET, { invoice: { invoice_id: 'i1' } }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
