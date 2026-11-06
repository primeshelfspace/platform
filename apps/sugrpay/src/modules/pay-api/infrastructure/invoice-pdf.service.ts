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
    try {
      await this.launch();
      this.logger.log('headless chromium launched for invoice PDF rendering');
    } catch (error) {
      // Deliberately swallowed, not rethrown: onModuleInit throwing here
      // would crash Nest's bootstrap and take the *entire* API down over a
      // side feature — that already happened once on staging (AppArmor
      // blocking the sandboxed launch, fixed in a prior commit) and cost
      // every other endpoint, not just Download PDF. render() below still
      // reports a clear per-request failure; nothing else is allowed to.
      this.logger.error(
        `headless chromium failed to launch — invoice PDF generation will fail until this ` +
          `is fixed (see the app's own logs above for the underlying error): ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close();
  }

  private async launch(): Promise<void> {
    const args = [
      // Chrome's own sandbox needs unprivileged user namespaces, which
      // recent Ubuntu locks down via AppArmor by default. Safe to drop
      // here — this browser only ever renders our own invoice-pdf-html.ts
      // output, never arbitrary/untrusted content from the web.
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // /dev/shm defaults to 64MB on many cloud VMs/containers — too small
      // for Chrome's shared memory needs, and it crashes rather than
      // falling back gracefully. This makes it use /tmp instead, which is
      // slower but not size-capped the same way.
      '--disable-dev-shm-usage',
      // No display and nothing this renders needs GPU-accelerated
      // compositing; avoids a class of driver/EGL failures headless
      // servers otherwise hit trying to initialise one anyway.
      '--disable-gpu',
    ];

    let browser: Browser;
    try {
      browser = await puppeteer.launch({ headless: true, args });
    } catch (error) {
      // Puppeteer's own bundled Chromium download, which lives under a
      // per-user cache directory. Some machines run an Application Control /
      // WDAC policy that only trusts binaries under Program Files and
      // refuses to spawn anything from there (observed locally as Windows'
      // "An Application Control policy has blocked this file", surfaced by
      // Node as `spawn UNKNOWN`) — falling back to the system-installed
      // Chrome, which such policies do trust, recovers without needing a
      // policy exception.
      this.logger.warn(
        `bundled chromium failed to launch, retrying with the system-installed Chrome: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      browser = await puppeteer.launch({ headless: true, channel: 'chrome', args });
    }

    // Chromium can exit on its own while the API keeps running (in production
    // it did, minutes after start). Before this, the dead browser stayed in
    // this.browser and every PDF failed with "Connection closed" until the
    // API was restarted. Forgetting it here makes the next render launch a
    // new one.
    browser.on('disconnected', () => {
      if (this.browser !== browser) return;
      this.browser = null;
      this.logger.warn('headless chromium exited; a new one starts with the next PDF');
    });
    this.browser = browser;
  }

  /** The running browser, or a newly launched one if there is none or the
   * one we had has died. */
  private async liveBrowser(): Promise<Browser> {
    if (this.browser && !this.browser.connected) this.browser = null;
    // A boot-time launch failure (see onModuleInit) leaves this null forever
    // otherwise — retrying here means a transient failure (box was mid
    // provisioning, briefly out of memory) recovers on its own instead of
    // requiring a manual restart once whatever caused it clears up.
    if (!this.browser) await this.launch().catch(() => undefined);
    if (!this.browser) {
      throw new Error('headless chromium is not available — invoice PDF rendering is down');
    }
    return this.browser;
  }

  async render(html: string): Promise<Buffer> {
    try {
      return await this.renderWith(await this.liveBrowser(), html);
    } catch (error) {
      if (!isBrowserGone(error)) throw error;
      // The browser died between the check above and the render (or mid
      // render): start a fresh one and try once more.
      this.logger.warn('headless chromium was gone during a render; retrying with a new one');
      const dead = this.browser;
      this.browser = null;
      await dead?.close().catch(() => undefined);
      return this.renderWith(await this.liveBrowser(), html);
    }
  }

  private async renderWith(browser: Browser, html: string): Promise<Buffer> {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'a4', printBackground: true });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}

/** Puppeteer's errors when the browser process is no longer there. */
function isBrowserGone(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ConnectionClosedError' ||
    error.name === 'TargetCloseError' ||
    /connection closed|target closed|browser has disconnected|session closed/i.test(error.message)
  );
}
