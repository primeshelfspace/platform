/**
 * Queue topology (TDD-001 §14.1).
 *
 * Six queues with separate worker pools, so priority is structural rather than
 * advisory: a backlog of insight jobs cannot delay a payment webhook
 * (NFR-SCL-003).
 */
import type { JobsOptions } from 'bullmq';

export const QUEUE_NAMES = [
  'payment-events',
  'mail',
  'sync',
  'documents',
  'scheduled',
  'insights',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface QueueDefinition {
  readonly name: QueueName;
  readonly description: string;
  /** BullMQ priority: lower number runs first. */
  readonly priority: number;
  readonly concurrency: number;
  readonly defaultJobOptions: JobsOptions;
}

const removeOnComplete = { age: 24 * 3600, count: 5_000 };
const removeOnFail = { age: 14 * 24 * 3600 };

export const QUEUES: Record<QueueName, QueueDefinition> = {
  'payment-events': {
    name: 'payment-events',
    description: 'Gateway webhook processing and settlement recording.',
    priority: 1,
    concurrency: 8,
    // Money moves here. Ten attempts with a short initial backoff, because a
    // dropped settlement is uncollected revenue, not a retryable inconvenience.
    defaultJobOptions: {
      attempts: 10,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete,
      removeOnFail,
    },
  },
  mail: {
    name: 'mail',
    description: 'Invoice, reminder, receipt and notification dispatch.',
    priority: 2,
    concurrency: 6,
    // 5 attempts spread across roughly six hours.
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete,
      removeOnFail,
    },
  },
  sync: {
    name: 'sync',
    description: 'Zoho and Shopify push and pull.',
    priority: 3,
    concurrency: 4,
    // 5 attempts over roughly 30 minutes, matching TDD-001 §11.2 TRANSIENT.
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete,
      removeOnFail,
    },
  },
  documents: {
    name: 'documents',
    description: 'PDF invoice and receipt rendering.',
    priority: 3,
    concurrency: 2, // headless Chromium is memory-hungry; keep the pool small
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete,
      removeOnFail,
    },
  },
  scheduled: {
    name: 'scheduled',
    description: 'Overdue marking, reminder cadence, reconciliation, health checks.',
    priority: 4,
    concurrency: 2,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete,
      removeOnFail,
    },
  },
  insights: {
    name: 'insights',
    description: 'AI summary and design generation (Phase 2).',
    priority: 5,
    concurrency: 1,
    // Fails silently to a degraded view; an insight is never load-bearing.
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete,
      removeOnFail,
    },
  },
};

/**
 * Scheduled jobs and their cadence (TDD-001 §14.2).
 *
 * `implemented` is the contract between the two processes. The API registers
 * the repeatables; src/worker.ts holds the handlers — separate processes, so
 * the API cannot introspect the worker's handler map at runtime. Registering a
 * job whose handler does not exist yet is not a harmless placeholder: BullMQ
 * fires it on schedule, the worker throws `no handler registered`, and the job
 * burns its full retry budget on every tick, forever. The whole list stays
 * visible here so the gap is legible; only the implemented entries are actually
 * scheduled.
 */
export const SCHEDULED_JOBS = [
  {
    name: 'overdue-evaluation',
    cron: '5 * * * *',
    description: "Marks overdue invoices in each brand's own time zone.",
    implemented: false,
  },
  {
    name: 'reminder-dispatch',
    cron: '15 * * * *',
    description: 'Sends reminders per brand schedule; suppressed for Paid and Cancelled.',
    implemented: false,
  },
  {
    name: 'scheduled-sync',
    // The tick itself is just the resolution the per-brand check runs at —
    // worker.ts's handler only actually enqueues a brand's pull once
    // `pullFrequencyMinutes` has elapsed since its own lastPulledAt. 1 minute
    // is the floor a brand can configure ("Realtime"), so the cron cannot
    // tick any less often than that without silently capping that option.
    cron: '* * * * *',
    description: "Enqueues per-brand sync at the brand's configured frequency.",
    implemented: true,
  },
  {
    name: 'domain-health-check',
    cron: '0 */6 * * *',
    description: 'Re-verifies custom domains and checks certificate expiry.',
    implemented: false,
  },
  {
    name: 'balance-reconciliation',
    cron: '30 2 * * *',
    description: 'Verifies stored balance against summed payments; alerts on divergence.',
    implemented: false,
  },
  {
    name: 'retention-purge',
    cron: '0 3 * * *',
    description: 'Removes check images past their retention period.',
    implemented: false,
  },
  {
    name: 'backup-verification',
    cron: '0 4 * * *',
    description: 'Confirms the most recent backup is restorable.',
    implemented: false,
  },
] as const;

export type ScheduledJobName = (typeof SCHEDULED_JOBS)[number]['name'];

/** The subset that has a handler in src/worker.ts and is safe to schedule. */
export const IMPLEMENTED_SCHEDULED_JOBS = SCHEDULED_JOBS.filter((job) => job.implemented);
