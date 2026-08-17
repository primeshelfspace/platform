import { PageContainer } from './page-container';

/**
 * Route-level fallback rendered by a route's loading.tsx while that route's
 * own server-side data fetch is in flight — see (app)/invoices/loading.tsx
 * and its siblings.
 *
 * Deliberately generic rather than a pixel match for each destination: the
 * point is "something moved immediately", not a placeholder that mimics the
 * real layout row-for-row. `rows` lets a route hint at roughly how much
 * content is coming (a detail page vs. a long list) without needing its own
 * bespoke skeleton.
 *
 * The fade-in delay and pulse are defined in globals.css (`skeleton-fade-in`,
 * `skeleton-block`) so this file stays about structure, not animation.
 */
export function PageSkeleton({ rows = 4, compact = false }: { rows?: number; compact?: boolean }) {
  return (
    <PageContainer compact={compact}>
      <div className="skeleton-fade-in" aria-hidden>
        <div className="skeleton-block h-4 w-40 rounded bg-surface-muted" />
        <div className="skeleton-block mt-3 h-7 w-64 rounded bg-surface-muted" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: rows }, (_, index) => (
            <div
              key={index}
              className="skeleton-block h-14 rounded-lg border border-border bg-surface-muted/60"
            />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
