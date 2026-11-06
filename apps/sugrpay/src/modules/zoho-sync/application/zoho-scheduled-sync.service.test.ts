/**
 * Sync Frequency (FR-ZHO-030): the every-minute tick pulls a brand only when
 * its interval has passed. Real-time (0, the default) is every 15 minutes, on
 * top of the changes Zoho's webhooks bring within seconds.
 *
 * Brands on one Zoho organisation share its API limits, so the tick pulls at
 * most one of them at a time, and none while Zoho is pausing the organisation
 * or once timed pulls have used their share of today's allowance.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '@platform/server';
import type { ZohoBooksAdapter } from '../../../adapters/accounting/zoho-books.adapter.js';
import type { QueueService } from '../../../infra/queue/queue.service.js';
import type { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';
import type { LiveZohoConnection, ZohoConnectionService } from './zoho-connection.service.js';
import { ZohoScheduledSyncService } from './zoho-scheduled-sync.service.js';

const MINUTE = 60_000;

type Connection = Omit<LiveZohoConnection, 'organisationId'> & { organisationId?: string | null };

function scheduler(
  connections: Connection[],
  options: {
    enabled?: boolean;
    paused?: string[];
    callsToday?: Record<string, number>;
    dailyLimit?: number;
  } = {},
) {
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    withoutScope: async (_why: string, work: (c: unknown) => Promise<unknown>) =>
      work({ syncJob: { updateMany: async () => ({ count: 0 }) } }),
  } as unknown as InvoicingPrismaService;
  const zoho = {
    rateLimitedUntil: async (organisationId: string) =>
      options.paused?.includes(organisationId) ? new Date(Date.now() + 10 * MINUTE) : null,
    callsToday: async (organisationId: string) => options.callsToday?.[organisationId] ?? 0,
  } as unknown as ZohoBooksAdapter;
  // Each brand on its own organisation unless the test says otherwise.
  const live = connections.map((c) => ({
    ...c,
    organisationId: c.organisationId === undefined ? `org-${c.brandId}` : c.organisationId,
  }));
  const service = new ZohoScheduledSyncService(
    {
      ZOHO_SCHEDULED_PULL_ENABLED: options.enabled ?? true,
      ZOHO_DAILY_CALL_LIMIT: options.dailyLimit ?? 1000,
    } as Env,
    prisma,
    { listLiveZohoConnections: async () => live } as unknown as ZohoConnectionService,
    { enqueue } as unknown as QueueService,
    zoho,
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

  it('pulls a Real-time brand every 15 minutes, not every 5', async () => {
    const now = Date.now();
    const { service, enqueued } = scheduler([
      {
        brandId: 'real-time-due',
        lastPulledAt: new Date(now - 16 * MINUTE),
        pullFrequencyMinutes: 0,
      },
      {
        brandId: 'real-time-6-minutes-ago',
        lastPulledAt: new Date(now - 6 * MINUTE),
        pullFrequencyMinutes: 0,
      },
      { brandId: 'real-time-never', lastPulledAt: null, pullFrequencyMinutes: 0 },
    ]);

    await service.tick();

    expect(enqueued().sort()).toEqual(['real-time-due', 'real-time-never']);
  });

  it('pulls one brand per Zoho organisation per tick, the most overdue first', async () => {
    const now = Date.now();
    const { service, enqueued } = scheduler([
      {
        brandId: 'shared-a-20-minutes',
        lastPulledAt: new Date(now - 20 * MINUTE),
        pullFrequencyMinutes: 15,
        organisationId: 'shared',
      },
      {
        brandId: 'shared-b-never',
        lastPulledAt: null,
        pullFrequencyMinutes: 15,
        organisationId: 'shared',
      },
      {
        brandId: 'shared-c-40-minutes',
        lastPulledAt: new Date(now - 40 * MINUTE),
        pullFrequencyMinutes: 15,
        organisationId: 'shared',
      },
      { brandId: 'alone', lastPulledAt: null, pullFrequencyMinutes: 15 },
    ]);

    await service.tick();

    expect(enqueued().sort()).toEqual(['alone', 'shared-b-never']);
  });

  it('pulls nothing on an organisation Zoho is pausing', async () => {
    const { service, enqueued } = scheduler(
      [
        { brandId: 'paused', lastPulledAt: null, pullFrequencyMinutes: 0, organisationId: 'p' },
        { brandId: 'fine', lastPulledAt: null, pullFrequencyMinutes: 0, organisationId: 'f' },
      ],
      { paused: ['p'] },
    );

    const result = await service.tick();

    expect(enqueued()).toEqual(['fine']);
    expect(result.organisationsHeld).toBe(1);
  });

  it("stops timed pulls once they have used 60% of the organisation's daily allowance", async () => {
    const { service, enqueued } = scheduler(
      [
        { brandId: 'used-up', lastPulledAt: null, pullFrequencyMinutes: 0, organisationId: 'u' },
        { brandId: 'below', lastPulledAt: null, pullFrequencyMinutes: 0, organisationId: 'b' },
      ],
      { dailyLimit: 1000, callsToday: { u: 600, b: 599 } },
    );

    const result = await service.tick();

    expect(enqueued()).toEqual(['below']);
    expect(result.organisationsHeld).toBe(1);
  });

  it('pulls nothing while timed pulls are switched off on the server', async () => {
    const { service, enqueued } = scheduler(
      [{ brandId: 'every-15', lastPulledAt: null, pullFrequencyMinutes: 15 }],
      { enabled: false },
    );

    await service.tick();

    expect(enqueued()).toEqual([]);
  });
});
