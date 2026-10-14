import { Injectable } from '@nestjs/common';

export type Probe = () => Promise<unknown>;

/**
 * Readiness probes contributed by the modules that own the dependency. The
 * health endpoint is shared infrastructure and must not know which modules
 * exist — each module's database registers itself here instead (e.g.
 * "postgres:platform", "postgres:invoicing").
 */
@Injectable()
export class HealthChecks {
  private readonly probes = new Map<string, Probe>();

  register(name: string, probe: Probe): void {
    this.probes.set(name, probe);
  }

  entries(): ReadonlyArray<readonly [string, Probe]> {
    return [...this.probes.entries()];
  }
}
