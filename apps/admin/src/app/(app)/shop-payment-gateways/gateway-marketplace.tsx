'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, CheckCircle2, Globe, Search, ShoppingBag, Star, Zap } from 'lucide-react';
import {
  COUNTRIES_SUPPORTED,
  GATEWAY_CATEGORIES,
  GATEWAYS,
  TOP_PICKS,
  type GatewayCategoryKey,
  type GatewayHighlight,
  type GatewayListing,
} from './gateways-data';

const HIGHLIGHT_STYLES: Record<GatewayHighlight, { label: string; className: string }> = {
  BEST_SELLER: { label: 'Best Seller', className: 'bg-amber-400 text-[#1F2937]' },
  POPULAR: { label: 'Popular', className: 'bg-white text-[#6D28D9]' },
  NEW: { label: 'New', className: 'bg-emerald-100 text-emerald-800' },
};

/** Fixed order, positional rather than meaning-tied — every card shows
 * exactly three features and the mock renders them with these same three
 * icons regardless of what the feature actually says. */
const FEATURE_ICONS = [CheckCircle2, Zap, Globe] as const;

type FilterKey = 'all' | GatewayCategoryKey;

function categoryLabel(key: GatewayCategoryKey): string {
  return GATEWAY_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

function StarRow({ rating }: { rating: number }) {
  const filled = Math.round(rating);
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < filled ? 'fill-amber-400 text-amber-400' : 'fill-none text-ink-subtle/40'
          }`}
        />
      ))}
    </span>
  );
}

function GatewayCard({ gateway, connectHref }: { gateway: GatewayListing; connectHref: string }) {
  const highlight = gateway.highlight ? HIGHLIGHT_STYLES[gateway.highlight] : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="relative h-28 shrink-0" style={{ backgroundColor: gateway.bannerColor }}>
        <div className="absolute right-4 top-4 flex items-center gap-2">
          {highlight && (
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${highlight.className}`}>
              {highlight.label}
            </span>
          )}
          <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
            {categoryLabel(gateway.category)}
          </span>
        </div>
        <div
          className="absolute -bottom-7 left-6 flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-md ring-4 ring-white"
          style={{ backgroundColor: gateway.accentColor }}
          aria-hidden
        >
          {gateway.initials}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-6 pb-6 pt-10">
        <h3 className="text-lg font-bold text-ink-strong">{gateway.name}</h3>
        <p className="text-sm text-ink-muted">{gateway.tagline}</p>

        <div className="mt-2 flex items-center gap-1.5">
          <StarRow rating={gateway.rating} />
          <span className="text-sm font-bold text-ink-strong">{gateway.rating}</span>
          <span className="text-sm text-ink-subtle">
            ({gateway.reviews.toLocaleString()} reviews)
          </span>
        </div>

        <p className="mt-3 text-sm text-ink-muted">{gateway.description}</p>

        <ul className="mt-4 space-y-2.5">
          {gateway.features.map((feature, i) => {
            // features is always exactly three (see the field's own comment),
            // matching FEATURE_ICONS' length — the index is never out of range.
            const Icon = FEATURE_ICONS[i]!;
            return (
              <li key={feature} className="flex items-center gap-2 text-sm text-ink-strong">
                <Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                {feature}
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex flex-1 items-end justify-between gap-4 border-t border-border pt-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-subtle">
              Processing fee
            </p>
            <p className="text-sm font-bold text-ink-strong">{gateway.fee}</p>
          </div>
          <Link
            href={connectHref}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white
                       transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-offset-2"
            style={{ backgroundColor: gateway.accentColor }}
          >
            Shop Now
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Browse-and-compare catalog of third-party payment processors. Purely a
 * marketing/discovery surface — connecting one for real still happens on the
 * existing Payment Gateways tab (FR-PAY's real OAuth/connect flow), which
 * "Shop Now" links out to with this brand carried forward.
 */
export function GatewayMarketplace() {
  const searchParams = useSearchParams();
  const brandId = searchParams.get('brandId');
  const connectHref = brandId
    ? `/settings/integrations?tab=payments&brandId=${brandId}`
    : '/settings/integrations?tab=payments';

  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GATEWAYS.filter((g) => {
      if (filter !== 'all' && g.category !== filter) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        g.tagline.toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q)
      );
    });
  }, [filter, query]);

  return (
    <div>
      <section className="rounded-xl bg-[#171717] p-8 text-white">
        <div className="flex flex-wrap items-center justify-between gap-10">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-[#A3A3A3]">
              <ShoppingBag className="h-3.5 w-3.5" aria-hidden />
              Marketplace
            </div>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight">Shop Payment Gateways</h1>
            <p className="mt-4 text-[#D4D4D4]">
              Connect a payment processor to your branded invoice pages. Compare features, fees, and
              global reach — then activate in one click.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#A3A3A3]">
                Top picks:
              </span>
              {TOP_PICKS.map((gateway) => (
                <span
                  key={gateway.key}
                  className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/10 py-1.5 pl-1.5 pr-4 text-sm font-bold text-white"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: gateway.accentColor }}
                  >
                    {gateway.initials}
                  </span>
                  {gateway.name}
                  <span className="flex items-center gap-1 text-amber-400">
                    <Star className="h-3.5 w-3.5 fill-current" aria-hidden />
                    {gateway.rating}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-8">
            <div>
              <p className="text-3xl font-extrabold">{GATEWAYS.length}</p>
              <p className="text-sm text-[#A3A3A3]">Gateways available</p>
            </div>
            <div className="h-10 w-px bg-white/15" aria-hidden />
            <div>
              <p className="text-3xl font-extrabold">{COUNTRIES_SUPPORTED}</p>
              <p className="text-sm text-[#A3A3A3]">Countries supported</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              filter === 'all'
                ? 'bg-black text-white'
                : 'border border-border bg-white text-ink-strong hover:bg-surface-muted'
            }`}
          >
            All
          </button>
          {GATEWAY_CATEGORIES.map((category) => (
            <button
              key={category.key}
              type="button"
              onClick={() => setFilter(category.key)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                filter === category.key
                  ? 'bg-black text-white'
                  : 'border border-border bg-white text-ink-strong hover:bg-surface-muted'
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search gateways"
            placeholder="Search gateways"
            className="h-10 w-full rounded-lg border border-border bg-surface-muted pl-9 pr-3 text-sm text-ink-strong
                       placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-ink-strong focus-visible:ring-offset-1"
          />
        </div>
      </div>

      <p className="mt-4 text-sm text-ink-muted">
        Showing <span className="font-bold text-ink-strong">{filtered.length}</span> of{' '}
        <span className="font-bold text-ink-strong">{GATEWAYS.length}</span> gateways
      </p>

      {filtered.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface-muted p-8 text-center">
          <p className="text-sm text-ink-muted">No gateways match your filters.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((gateway) => (
            <GatewayCard key={gateway.key} gateway={gateway} connectHref={connectHref} />
          ))}
        </div>
      )}
    </div>
  );
}
