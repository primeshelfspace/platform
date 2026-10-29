/**
 * Sync Frequency (FR-ZHO-030): the every-minute tick pulls a brand only when
 * its interval has passed. Real-time (0, the default) is every 5 minutes, on
 * top of the changes Zoho's webhooks bring within seconds.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '@platform/server';
import type { QueueService } from '../../../infra/queue/queue.service.js';
import type { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';
import type { ZohoConnectionService } from './zoho-connection.service.js';
import { ZohoScheduledSyncService } from './zoho-scheduled-sync.service.js';

const MINUTE = 60_000;

function scheduler(
  connections: Array<{ brandId: string; lastPulledAt: Date | null; pullFrequencyMinutes: number }>,
  enabled = true,
) {
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    withoutScope: async (_why: string, work: (c: unknown) => Promise<unknown>) =>
      work({ syncJob: { updateMany: async () => ({ count: 0 }) } }),
  } as unknown as InvoicingPrismaService;
  const service = new ZohoScheduledSyncService(
    { ZOHO_SCHEDULED_PULL_ENABLED: enabled } as Env,
    prisma,
    // The real query leaves Real-time brands out; the tick must too.
    { listLiveZohoConnections: async () => connections } as unknown as ZohoConnectionService,
    { enqueue } as unknown as QueueService,
  );
  return { service, enqueued: () => enqueue.mock.calls.map((call) => call[2].brandId) };
}

describe('scheduled Zoho pull', () => {
  it('pulls a brand only once its chosen interval has passed', async () => {
    const now = Date.now();
    const { service, enqueued } = scheduler([
      {
        brandId: 'every-15-due',
        lastPulledAt: new Date(now - 16 * MINUTE),
        pullFrequencyMinutes: 15,
      },
      {
        brandId: 'every-15-not-yet',
        lastPulledAt: new Date(now - 5 * MINUTE),
        pullFrequencyMinutes: 15,
      },
      {
        brandId: 'every-30-due',
        lastPulledAt: new Date(now - 31 * MINUTE),
        pullFrequencyMinutes: 30,
      },
      {
        brandId: 'daily-not-yet',
        lastPulledAt: new Date(now - 2 * 60 * MINUTE),
        pullFrequencyMinutes: 1440,
      },
      { brandId: 'never-pulled', lastPulledAt: null, pullFrequencyMinutes: 60 },
    ]);

    const result = await service.tick();

    expect(enqueued().sort()).toEqual(['every-15-due', 'every-30-due', 'never-pulled']);
    expect(result.brandsEnqueued).toBe(3);
  });

  it('pulls a Real-time brand every 5 minutes', async () => {
    const now = Date.now();
    const { service, enqueued } = scheduler([
      {
        brandId: 'real-time-due',
        lastPulledAt: new Date(now - 6 * MINUTE),
        pullFrequencyMinutes: 0,
      },
      {
        brandId: 'real-time-not-yet',
        lastPulledAt: new Date(now - 3 * MINUTE),
        pullFrequencyMinutes: 0,
      },
      { brandId: 'real-time-never', lastPulledAt: null, pullFrequencyMinutes: 0 },
    ]);

    await service.tick();

    expect(enqueued().sort()).toEqual(['real-time-due', 'real-time-never']);
  });

  it('pulls nothing while timed pulls are switched off on the server', async () => {
    const { service, enqueued } = scheduler(
      [{ brandId: 'every-15', lastPulledAt: null, pullFrequencyMinutes: 15 }],
      false,
    );

    await service.tick();

    expect(enqueued()).toEqual([]);
  });
});
