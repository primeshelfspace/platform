import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '@platform/server';
import { QueueService } from '../../../infra/queue/queue.service.js';
import { ZohoConnectionService } from './zoho-connection.service.js';
import { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';
import { ZohoBooksAdapter } from '../../../adapters/accounting/zoho-books.adapter.js';

/**
 * How long a SyncJob may sit in RUNNING before it is treated as abandoned
 * rather than slow. See tick() for why this exists and why thirty minutes is
 * the right side of every legitimate job.
 */
const STALE_SYNC_JOB_MS = 30 * 60 * 1000;

/** Real-time (Sync Frequency 0): Zoho's webhooks bring changes within
 * seconds; the timed pull is only the safety net for anything a webhook
 * missed. It was every 5 minutes, which with 13 brands on two Zoho
 * organisations used up Zoho's daily API allowance by midnight: Zoho then
 * answered 429 all day, and pushes failed with it. */
export const REAL_TIME_PULL_MINUTES = 15;

/** Timed pulls stop for the day once an organisation has used this share of
 * its daily Zoho allowance (ZOHO_DAILY_CALL_LIMIT), so the rest is left for
 * what people actually do: pushing invoices and customers, "Sync now". */
export const SCHEDULED_SHARE_OF_DAILY_LIMIT = 0.6;

/** Minutes between timed pulls for a brand's Sync Frequency. */
export function pullIntervalMinutes(frequency: number): number {
  return frequency === 0 ? REAL_TIME_PULL_MINUTES : frequency;
}

export interface ScheduledSyncResult {
  readonly brandsConnected: number;
  readonly brandsEnqueued: number;
  readonly staleJobsReaped: number;
  /** Organisations with a brand due but skipped this tick: Zoho is pausing
   * them, or their timed pulls have used today's share. */
  readonly organisationsHeld: number;
}

/**
 * The 'scheduled-sync' repeatable job (queues.ts, registered by the API
 * process via QueueService.registerScheduledJobs) ticks every minute — that
 * is just this handler's own resolution, not any one brand's cadence. Each
 * tick lists every live Zoho connection and enqueues a pull only for the
 * brands actually due, per their own pullFrequencyMinutes (FR-ZHO-030); a
 * brand configured for "Daily" is skipped on the other 1,439 ticks.
 *
 * Connections are the platform's, so they are listed through its public API;
 * sync jobs are invoicing's own.
 */
@Injectable()
export class ZohoScheduledSyncService {
  private readonly logger = new Logger('scheduled-sync');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: InvoicingPrismaService,
    private readonly connections: ZohoConnectionService,
    private readonly queue: QueueService,
    private readonly zoho: ZohoBooksAdapter,
  ) {}

  async tick(): Promise<ScheduledSyncResult> {
    // G-11. A SyncJob row is set RUNNING before its work starts and moved to
    // SUCCEEDED/SKIPPED/FAILED after, so a process that dies mid-job — a
    // deploy, an OOM kill, a crash — leaves the row RUNNING with nothing that
    // will ever transition it. They accumulate silently and, because the
    // integrations panel shows the most recent rows, eventually crowd out the
    // real activity with jobs that are permanently "in flight".
    //
    // Thirty minutes is comfortably longer than any legitimate job: the
    // per-record pulls are single API calls, the list scans are bounded by the
    // rate limiter, and BullMQ's own retry budget for this queue is about the
    // same span — so anything still RUNNING past it is not slow, it is gone.
    // Guarded: reaping is housekeeping, and it runs before the part of this
    // tick that actually enqueues pulls. Letting it throw would mean no brand
    // syncs at all this tick — trading a cosmetic backlog of stale rows for
    // real data going stale.
    let staleJobsReaped = 0;
    try {
      const reaped = await this.prisma.withoutScope(
        'scheduled-sync: failing sync jobs orphaned by a crashed worker',
        (client) =>
          client.syncJob.updateMany({
            where: {
              status: 'RUNNING',
              createdAt: { lt: new Date(Date.now() - STALE_SYNC_JOB_MS) },
            },
            data: {
              status: 'FAILED',
              errorClass: 'PERMANENT',
              lastError: 'abandoned — the worker processing this job stopped before finishing it',
            },
          }),
      );
      staleJobsReaped = reaped.count;
      if (staleJobsReaped > 0) {
        this.logger.warn(`failed ${staleJobsReaped} sync job(s) orphaned by a crash`);
      }
    } catch (error) {
      this.logger.warn(
        `could not reap orphaned sync jobs, continuing to the pull scan: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Each brand chooses its own Sync Frequency; Real-time (the default)
    // is pulled every REAL_TIME_PULL_MINUTES on top of its webhooks.
    // ZOHO_SCHEDULED_PULL_ENABLED=false stops every timed pull at once (an
    // emergency switch); the tick itself stays, for the reaping above, which
    // makes no Zoho calls.
    if (!this.env.ZOHO_SCHEDULED_PULL_ENABLED) {
      return { brandsConnected: 0, brandsEnqueued: 0, staleJobsReaped, organisationsHeld: 0 };
    }

    const live = await this.connections.listLiveZohoConnections();
    const now = Date.now();
    const overdueBy = (c: (typeof live)[number]) =>
      c.lastPulledAt
        ? now - c.lastPulledAt.getTime() - pullIntervalMinutes(c.pullFrequencyMinutes) * 60_000
        : Number.POSITIVE_INFINITY;
    const due = live.filter((c) => overdueBy(c) >= 0);

    // Brands on one Zoho organisation share its limits, so they take turns:
    // at most one of them per tick, the most overdue first. Before, every due
    // brand was queued in the same second and they hit Zoho together.
    const byOrganisation = new Map<string, (typeof due)[number]>();
    for (const connection of due) {
      const key = connection.organisationId ?? `brand:${connection.brandId}`;
      const current = byOrganisation.get(key);
      if (!current || overdueBy(connection) > overdueBy(current)) {
        byOrganisation.set(key, connection);
      }
    }

    const budget = Math.floor(this.env.ZOHO_DAILY_CALL_LIMIT * SCHEDULED_SHARE_OF_DAILY_LIMIT);
    const toPull: string[] = [];
    let organisationsHeld = 0;
    for (const connection of byOrganisation.values()) {
      const organisationId = connection.organisationId;
      if (organisationId) {
        // Zoho is pausing this organisation: queueing a pull now would only be
        // skipped by the pull itself. Wait for the pause to end.
        if (await this.zoho.rateLimitedUntil(organisationId)) {
          organisationsHeld++;
          continue;
        }
        if ((await this.zoho.callsToday(organisationId)) >= budget) {
          organisationsHeld++;
          continue;
        }
      }
      toPull.push(connection.brandId);
    }

    await Promise.all(
      toPull.map((brandId) => this.queue.enqueue('sync', 'zoho-pull-brand', { brandId })),
    );
    return {
      brandsConnected: live.length,
      brandsEnqueued: toPull.length,
      staleJobsReaped,
      organisationsHeld,
    };
  }
}
