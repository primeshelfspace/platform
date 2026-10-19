/**
 * Integration error classification (TDD-001 §11.2).
 *
 * Every adapter maps provider failures onto these classes. The sync worker
 * decides retry, halt or dead-letter from the class alone, so adding a provider
 * does not mean teaching the worker a new failure vocabulary.
 */

export const ERROR_CLASSES = [
  'TRANSIENT',
  'AUTHENTICATION',
  'VALIDATION',
  'CONFLICT',
  'PERMANENT',
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export interface RetryPolicy {
  readonly retryable: boolean;
  readonly maxAttempts: number;
  /** Halt the whole brand stream rather than just this job. */
  readonly haltStream: boolean;
  /** Raise an operator alert immediately rather than on exhaustion. */
  readonly alertImmediately: boolean;
}

export const RETRY_POLICY: Record<ErrorClass, RetryPolicy> = {
  // Exponential backoff with jitter, ~30 minutes across 5 attempts.
  TRANSIENT: { retryable: true, maxAttempts: 5, haltStream: false, alertImmediately: false },
  // Retrying a revoked token cannot succeed. Stop and tell someone.
  AUTHENTICATION: { retryable: false, maxAttempts: 1, haltStream: true, alertImmediately: true },
  VALIDATION: { retryable: false, maxAttempts: 1, haltStream: false, alertImmediately: false },
  CONFLICT: { retryable: false, maxAttempts: 1, haltStream: false, alertImmediately: false },
  PERMANENT: { retryable: false, maxAttempts: 1, haltStream: false, alertImmediately: true },
};

/**
 * The error type every port throws. Carries the provider's verbatim message so
 * the operator-facing error log can show what the provider actually said
 * (FR-ZHO-021) rather than a paraphrase.
 */
export class IntegrationError extends Error {
  readonly errorClass: ErrorClass;
  readonly provider: string;
  readonly providerMessage: string | undefined;
  readonly providerCode: string | undefined;
  readonly httpStatus: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(input: {
    message: string;
    errorClass: ErrorClass;
    provider: string;
    providerMessage?: string;
    providerCode?: string;
    httpStatus?: number;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = 'IntegrationError';
    this.errorClass = input.errorClass;
    this.provider = input.provider;
    this.providerMessage = input.providerMessage;
    this.providerCode = input.providerCode;
    this.httpStatus = input.httpStatus;
    this.retryAfterMs = input.retryAfterMs;
  }

  get policy(): RetryPolicy {
    return RETRY_POLICY[this.errorClass];
  }

  get retryable(): boolean {
    return this.policy.retryable;
  }
}

/** Default HTTP status → class mapping. Adapters override where a provider differs. */
export function classifyHttpStatus(status: number): ErrorClass {
  if (status === 401 || status === 403) return 'AUTHENTICATION';
  if (status === 404 || status === 410) return 'PERMANENT';
  if (status === 409 || status === 412) return 'CONFLICT';
  if (status === 422 || (status >= 400 && status < 429)) return 'VALIDATION';
  if (status === 429) return 'TRANSIENT';
  if (status >= 500) return 'TRANSIENT';
  return 'PERMANENT';
}

/** Backoff schedule for TRANSIENT: exponential with full jitter. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 15 * 60_000);
  return Math.round(base * (0.5 + random() * 0.5));
}
