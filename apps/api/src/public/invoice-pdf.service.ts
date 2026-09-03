import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';

/**
 * Renders invoice-pdf-html.ts's HTML into an actual PDF via headless
 * Chromium.
 *
 * One browser instance for the process lifetime, not one per request — a
 * fresh launch is the expensive part (spawning a whole Chromium process
 * tree), while a single already-running browser opens and closes pages
 * cheaply. Mirrors RedisService's own connect-once-in-onModuleInit,
 * disconnect-in-onModuleDestroy shape.
 */
@Injectable()
export class InvoicePdfService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoicePdfService.name);
  private browser: Browser | null = null;

  async onModuleInit(): Promise<void> {
    this.browser = await puppeteer.launch({ headless: true });
    this.logger.log('headless chromium launched for invoice PDF rendering');
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close();
  }

  async render(html: string): Promise<Buffer> {
    if (!this.browser) throw new Error('InvoicePdfService used before onModuleInit ran');

    const page = await this.browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'a4', printBackground: true });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}
