import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '@platform/server';
import { QueueService } from '../../../infra/queue/queue.service.js';
import { ZohoConnectionService } from './zoho-connection.service.js';
import { InvoicingPrismaService } from '../../database/invoicing-prisma.service.js';

/**
 * How long a SyncJob may sit in RUNNING before it is treated as abandoned
 * rather than slow. See tick() for why this exists and why thirty minutes is
 * the right side of every legitimate job.
 */
const STALE_SYNC_JOB_MS = 30 * 60 * 1000;

/** Real-time (Sync Frequency 0): Zoho's webhooks bring changes within
 * seconds, and a full sync every 5 minutes catches any Zoho fails to send. */
export const REAL_TIME_PULL_MINUTES = 5;

/** Minutes between timed pulls for a brand's Sync Frequency. */
export function pullIntervalMinutes(frequency: number): number {
  return frequency === 0 ? REAL_TIME_PULL_MINUTES : frequency;
}

export interface ScheduledSyncResult {
  readonly brandsConnected: number;
  readonly brandsEnqueued: number;
  readonly staleJobsReaped: number;
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
      return { brandsConnected: 0, brandsEnqueued: 0, staleJobsReaped };
    }

    const live = await this.connections.listLiveZohoConnections();
    const now = Date.now();
    const due = live.filter(
      (c) =>
        !c.lastPulledAt ||
        now - c.lastPulledAt.getTime() >= pullIntervalMinutes(c.pullFrequencyMinutes) * 60_000,
    );
    await Promise.all(
      due.map(({ brandId }) => this.queue.enqueue('sync', 'zoho-pull-brand', { brandId })),
    );
    return { brandsConnected: live.length, brandsEnqueued: due.length, staleJobsReaped };
  }
}
