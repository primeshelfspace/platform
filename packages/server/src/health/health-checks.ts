import { Injectable } from '@nestjs/common';

export type Probe = () => Promise<unknown>;

/**
 * Readiness probes and adapter names contributed by whatever the running API
 * owns. The health endpoint is shared and must not know which API it is in —
 * each one registers its own database ("postgres:platform"), queues, and the
 * adapters it runs with (Sugrpay: payment gateway, accounting).
 */
@Injectable()
export class HealthChecks {
  private readonly probes = new Map<string, Probe>();
  private readonly adapterNames = new Map<string, string>();

  register(name: string, probe: Probe): void {
    this.probes.set(name, probe);
  }

  entries(): ReadonlyArray<readonly [string, Probe]> {
    return [...this.probes.entries()];
  }

  /** Records which adapter is in use, e.g. ('paymentGateway', 'stripe'). */
  describeAdapter(role: string, provider: string): void {
    this.adapterNames.set(role, provider);
  }

  adapters(): Record<string, string> {
    return Object.fromEntries(this.adapterNames);
  }
}
