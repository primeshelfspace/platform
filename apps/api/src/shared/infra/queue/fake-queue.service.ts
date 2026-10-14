import type { QueueService } from './queue.service.js';

/**
 * Zero-op stand-in for tests that need a QueueService instance but must
 * never actually enqueue anything. CustomersService/InvoicesService/
 * PaymentsService each enqueue a Zoho sync job on every create/issue/settle;
 * a real QueueService puts that job in the same Redis the persistent worker
 * process reads from, and that worker will push it to whichever brand's
 * Zoho connection is live at that moment — including one that gets
 * connected later, after the test was written, by someone clicking around
 * the admin UI. That is exactly how test-fixture customers ended up pushed
 * to a real Zoho account, twice, in one session — picking a brand believed
 * to be "safe" is not durable, so this makes it structurally impossible
 * instead.
 */
export function createFakeQueueService(): QueueService {
  return { enqueue: async () => 'fake-job-id' } as unknown as QueueService;
}
