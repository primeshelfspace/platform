import { afterAll, describe, expect, it } from 'vitest';
import { InvoicePdfService } from './invoice-pdf.service.js';

/**
 * In production the headless browser exited on its own minutes after the API
 * started, and every Download PDF then failed with "Connection closed" until
 * a restart. These kill the browser the way that happened and check the next
 * PDF still comes out.
 */
describe('InvoicePdfService: a browser that dies is replaced', () => {
  const service = new InvoicePdfService();
  const html = '<h1>Invoice INV-0001</h1>';
  const isPdf = (pdf: Buffer) => pdf.subarray(0, 5).toString() === '%PDF-';
  const browserOf = (s: InvoicePdfService) =>
    (s as unknown as { browser: import('puppeteer').Browser | null }).browser;

  afterAll(() => service.onModuleDestroy());

  it('renders a PDF', async () => {
    await service.onModuleInit();
    expect(isPdf(await service.render(html))).toBe(true);
  }, 60_000);

  it('renders again after the browser process is killed', async () => {
    const before = browserOf(service);
    expect(before).not.toBeNull();
    before!.process()?.kill('SIGKILL');
    // The process is gone; the API has not been told yet.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(isPdf(await service.render(html))).toBe(true);
    expect(browserOf(service)).not.toBe(before);
  }, 60_000);

  it('renders when the browser dies without the service noticing first', async () => {
    const before = browserOf(service)!;
    // Kill it and render at once, before the "disconnected" event can land:
    // the render itself hits the dead connection and has to retry.
    before.process()?.kill('SIGKILL');

    expect(isPdf(await service.render(html))).toBe(true);
  }, 60_000);
});
