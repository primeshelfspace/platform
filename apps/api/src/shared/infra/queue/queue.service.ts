import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../redis/redis.service.js';
import {
  IMPLEMENTED_SCHEDULED_JOBS,
  QUEUES,
  QUEUE_NAMES,
  SCHEDULED_JOBS,
  type QueueName,
} from './queues.js';

/**
 * Owns the producer side of every queue. Workers live in the worker process
 * (src/worker.ts) so a slow render or a Zoho outage cannot consume capacity the
 * API needs to answer requests.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    for (const name of QUEUE_NAMES) {
      const definition = QUEUES[name];
      this.queues.set(
        name,
        new Queue(name, {
          connection: this.redis.createQueueConnection(`queue-${name}`),
          defaultJobOptions: definition.defaultJobOptions,
        }),
      );
    }
    this.logger.log(`queues ready: ${QUEUE_NAMES.join(', ')}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }

  get(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`queue "${name}" was not initialised`);
    return queue;
  }

  /**
   * Enqueues work. `brandId` becomes the BullMQ job group so one brand's
   * backlog cannot starve another's (per-brand isolation, NFR-SCL-010).
   */
  async enqueue(
    queue: QueueName,
    jobName: string,
    payload: Record<string, unknown> & { brandId?: string },
    options: JobsOptions = {},
  ): Promise<string> {
    const job = await this.get(queue).add(jobName, payload, {
      priority: QUEUES[queue].priority,
      ...options,
    });
    return job.id ?? '';
  }

  /**
   * Registers the repeatable jobs from TDD-001 §14.2. Idempotent: BullMQ keys
   * repeatables by name and pattern, so re-running on deploy does not duplicate.
   *
   * Only jobs marked `implemented` in queues.ts are scheduled — a repeatable
   * with no handler in the worker process fails its whole retry budget on every
   * tick rather than sitting harmlessly idle. The sweep afterwards is what makes
   * that safe to change either way: repeatables live in Redis, not in this code,
   * so one flipped to `implemented: false` (or deleted outright) would otherwise
   * keep firing from a previous deploy's registration forever.
   */
  async registerScheduledJobs(): Promise<void> {
    const scheduled = this.get('scheduled');
    const wanted = new Set<string>(IMPLEMENTED_SCHEDULED_JOBS.map((job) => job.name));

    for (const job of IMPLEMENTED_SCHEDULED_JOBS) {
      await scheduled.add(
        job.name,
        { scheduledJob: job.name },
        { repeat: { pattern: job.cron }, jobId: `cron:${job.name}` },
      );
    }

    let removed = 0;
    for (const existing of await scheduled.getRepeatableJobs()) {
      if (wanted.has(existing.name)) continue;
      await scheduled.removeRepeatableByKey(existing.key);
      removed += 1;
      this.logger.warn(
        `removed orphaned repeatable "${existing.name}" — it has no handler in the worker process`,
      );
    }

    const deferred = SCHEDULED_JOBS.filter((job) => !job.implemented).map((job) => job.name);
    this.logger.log(
      `registered ${IMPLEMENTED_SCHEDULED_JOBS.length} scheduled jobs` +
        (removed > 0 ? `, removed ${removed} orphaned` : ''),
    );
    if (deferred.length > 0) {
      this.logger.log(`scheduled jobs awaiting a handler, not registered: ${deferred.join(', ')}`);
    }
  }

  /** Queue depths, for the health endpoint and the operations dashboard. */
  async counts(): Promise<Record<QueueName, Record<string, number>>> {
    const entries = await Promise.all(
      QUEUE_NAMES.map(async (name) => [name, await this.get(name).getJobCounts()] as const),
    );
    return Object.fromEntries(entries) as Record<QueueName, Record<string, number>>;
  }
}
