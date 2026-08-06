import { Activity, CircleCheck, CircleX, Plug } from 'lucide-react';
import { BRAND_COLOUR_PRESETS, assessBrandColour } from '@fenwick/shared/tokens';
import { BrandTheme } from '@/components/brand-theme';
import { API_URL, getHealth, type HealthResponse } from '@/lib/api';
import { PageContainer } from '@/components/page-container';

// The status of live dependencies is never cached.
export const dynamic = 'force-dynamic';

/** System diagnostics: is the API reachable, are its dependencies up, and does
 * brand theming resolve to accessible colours. Not the dashboard — that's `/`. */
export default async function StatusPage() {
  let health: HealthResponse | null = null;
  let error: string | null = null;

  try {
    health = await getHealth();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  return (
    <PageContainer>
      <header className="mb-10">
        <p className="text-sm uppercase tracking-widest text-ink-subtle">Fenwick Holdings Inc.</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink-strong">System status</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">
          Live dependency and theming diagnostics, not customer-facing data.
        </p>
      </header>

      <section className="mb-8 rounded-lg border border-border bg-surface p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-ink-muted" aria-hidden />
          <h2 className="font-medium text-ink-strong">API health</h2>
          <span className="ml-auto font-mono text-xs text-ink-subtle">{API_URL}</span>
        </div>

        {error ? (
          <div className="rounded-md bg-danger-surface p-4 text-sm text-danger">
            <p className="font-medium">The API is not reachable.</p>
            <p className="mt-1 font-mono text-xs">{error}</p>
            <p className="mt-2 text-ink-muted">
              Start it with <code className="font-mono">pnpm dev</code>, or bring dependencies up
              with <code className="font-mono">pnpm setup:local</code>.
            </p>
          </div>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {health?.checks.map((check) => (
                <li
                  key={check.name}
                  className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm"
                >
                  {check.state === 'up' ? (
                    <CircleCheck className="h-4 w-4 text-success" aria-hidden />
                  ) : (
                    <CircleX className="h-4 w-4 text-danger" aria-hidden />
                  )}
                  <span className="text-ink-strong">{check.name}</span>
                  <span className="ml-auto font-mono text-xs text-ink-subtle">
                    {check.durationMs}ms
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Plug className="h-4 w-4 text-ink-muted" aria-hidden />
              <span className="text-sm text-ink-muted">Bound adapters:</span>
              {Object.entries(health?.adapters ?? {}).map(([port, driver]) => (
                <span
                  key={port}
                  className="rounded-full bg-accent-surface px-2.5 py-0.5 text-xs text-ink-strong"
                >
                  {port}: <span className="font-mono">{driver}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <h2 className="mb-1 font-medium text-ink-strong">Brand theming</h2>
        <p className="mb-4 text-sm text-ink-muted">
          One component set, any brand&rsquo;s colours. The foreground is computed for contrast, so
          a brand colour that cannot carry readable text is caught here rather than on a
          customer&rsquo;s payment page.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          {BRAND_COLOUR_PRESETS.map((colour) => {
            const assessment = assessBrandColour(colour);
            return (
              <BrandTheme key={colour} brandColour={colour}>
                <div className="rounded-md border border-border p-3">
                  <button
                    type="button"
                    className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground"
                  >
                    Send invoice
                  </button>
                  <p className="mt-2 font-mono text-xs text-ink-subtle">{colour}</p>
                  <p className="text-xs text-ink-muted">
                    on-brand {assessment.onBrandRatio}:1 · text {assessment.brandInkRatio}:1
                  </p>
                </div>
              </BrandTheme>
            );
          })}
        </div>
      </section>
    </PageContainer>
  );
}
