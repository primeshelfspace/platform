/**
 * The gateway marketplace catalog.
 *
 * Static, hand-curated content — not brand or merchant data, and not fetched
 * from anywhere. Ratings, review counts and "Best Seller"/"Popular"/"New"
 * badges are editorial/marketing copy for this browse-and-compare screen,
 * the same way an app-store listing is; they aren't derived from this
 * platform's own usage. Processing fees are each provider's own published
 * headline rate, for comparison only — the actual rate a merchant pays is
 * whatever they agree with the provider once connected.
 */

export const GATEWAY_CATEGORIES = [
  { key: 'full-stack', label: 'Full Stack' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'bnpl', label: 'BNPL' },
  { key: 'gateway', label: 'Gateway' },
  { key: 'enterprise', label: 'Enterprise' },
  { key: 'omnichannel', label: 'Omnichannel' },
  { key: 'regional', label: 'Regional' },
] as const;

export type GatewayCategoryKey = (typeof GATEWAY_CATEGORIES)[number]['key'];

export type GatewayHighlight = 'BEST_SELLER' | 'POPULAR' | 'NEW';

export interface GatewayListing {
  readonly key: string;
  readonly name: string;
  readonly tagline: string;
  readonly initials: string;
  /** The card's banner background. */
  readonly bannerColor: string;
  /** The logo tile, and the "Shop Now" button — usually bannerColor, but a
   * couple of pastel banners (Klarna) need a deeper shade here to keep the
   * button and logo text readable. */
  readonly accentColor: string;
  readonly highlight: GatewayHighlight | null;
  readonly category: GatewayCategoryKey;
  readonly rating: number;
  readonly reviews: number;
  readonly description: string;
  /** Always exactly three — rendered with fixed icons (check, lightning,
   * globe) in this order, the same way every card in the mock does. */
  readonly features: readonly [string, string, string];
  readonly fee: string;
}

export const GATEWAYS: readonly GatewayListing[] = [
  {
    key: 'stripe',
    name: 'Stripe',
    tagline: "The internet's payment infrastructure",
    initials: 'S',
    bannerColor: '#635BFF',
    accentColor: '#635BFF',
    highlight: 'BEST_SELLER',
    category: 'full-stack',
    rating: 4.9,
    reviews: 12400,
    description:
      'Stripe powers millions of businesses with the most developer-friendly APIs, global coverage, and instant payouts in 135+ currencies.',
    features: ['135+ currencies', 'Instant payouts', 'Fraud protection'],
    fee: '2.9% + 30¢',
  },
  {
    key: 'paypal',
    name: 'PayPal',
    tagline: 'Trusted by 435M+ buyers worldwide',
    initials: 'P',
    bannerColor: '#0B1F63',
    accentColor: '#0B1F63',
    highlight: 'BEST_SELLER',
    category: 'wallet',
    rating: 4.7,
    reviews: 9800,
    description:
      'Offer your customers PayPal, Venmo, and Pay Later options in a single integration. High buyer trust accelerates checkout conversion.',
    features: ['Pay Later / BNPL', 'Buyer protection', 'One-tap checkout'],
    fee: '3.49% + 49¢',
  },
  {
    key: 'square',
    name: 'Square',
    tagline: 'Unified in-person and online commerce',
    initials: 'SQ',
    bannerColor: '#0A0A0A',
    accentColor: '#0A0A0A',
    highlight: 'POPULAR',
    category: 'omnichannel',
    rating: 4.6,
    reviews: 7200,
    description:
      'Square unifies your point-of-sale and online payments with real-time inventory sync, free dispute management, and next-day deposits.',
    features: ['Free POS hardware', 'Next-day deposits', 'Inventory sync'],
    fee: '2.6% + 10¢',
  },
  {
    key: 'authorize-net',
    name: 'Authorize.Net',
    tagline: 'Simple, reliable — trusted since 1996',
    initials: 'AN',
    bannerColor: '#E11D2E',
    accentColor: '#E11D2E',
    highlight: null,
    category: 'gateway',
    rating: 4.3,
    reviews: 4100,
    description:
      'Over 430,000 merchants rely on Authorize.Net for its rock-solid uptime, advanced fraud detection suite, and 24/7 live support.',
    features: ['24/7 live support', 'AFDS fraud suite', 'Card vault'],
    fee: '2.9% + 30¢ + $25/mo',
  },
  {
    key: 'braintree',
    name: 'Braintree',
    tagline: 'Enterprise payments from PayPal',
    initials: 'BT',
    bannerColor: '#0EA5E9',
    accentColor: '#0EA5E9',
    highlight: null,
    category: 'gateway',
    rating: 4.4,
    reviews: 2800,
    description:
      'Braintree offers a merchant account, gateway, and fraud tools in one — with transparent pricing and dedicated support for high-volume businesses.',
    features: ['No monthly fee', 'Advanced fraud', 'Recurring billing'],
    fee: '2.59% + 49¢',
  },
  {
    key: 'klarna',
    name: 'Klarna',
    tagline: 'Buy now, pay later — smarter shopping',
    initials: 'K',
    bannerColor: '#FFB3C7',
    accentColor: '#EC4899',
    highlight: 'POPULAR',
    category: 'bnpl',
    rating: 4.5,
    reviews: 5400,
    description:
      'Add Klarna to your checkout and lift conversion by up to 30%. Shoppers split purchases into 4 interest-free payments; you get paid in full instantly.',
    features: ['30% AOV lift', 'Interest-free BNPL', 'Instant full payout'],
    fee: '3.29% + 30¢',
  },
  {
    key: 'adyen',
    name: 'Adyen',
    tagline: 'One platform. Every payment. Anywhere.',
    initials: 'A',
    bannerColor: '#0ABF53',
    accentColor: '#0ABF53',
    highlight: null,
    category: 'enterprise',
    rating: 4.8,
    reviews: 3100,
    description:
      "Adyen's end-to-end platform gives enterprise merchants a single connection to global acquiring, risk management, and data-driven insights.",
    features: ['Global acquiring', 'Risk engine', 'Unified data'],
    fee: 'Custom pricing',
  },
  {
    key: 'razorpay',
    name: 'Razorpay',
    tagline: "Full-stack payments for South Asia",
    initials: 'R',
    bannerColor: '#2F6FED',
    accentColor: '#2F6FED',
    highlight: 'NEW',
    category: 'regional',
    rating: 4.6,
    reviews: 3700,
    description:
      "Razorpay supports 100+ payment methods including UPI, net banking, wallets, and cards — purpose-built for India's payment ecosystem.",
    features: ['UPI & net banking', '100+ methods', 'Route & split'],
    fee: '2% per transaction',
  },
  {
    key: 'worldpay',
    name: 'Worldpay',
    tagline: '40B+ transactions processed annually',
    initials: 'WP',
    bannerColor: '#6D28D9',
    accentColor: '#6D28D9',
    highlight: null,
    category: 'enterprise',
    rating: 4.4,
    reviews: 2200,
    description:
      "Worldpay's acquiring network spans 146 countries and 135 currencies, with advanced tokenization and dedicated enterprise relationship managers.",
    features: ['146 countries', 'Tokenization vault', 'Enterprise SLAs'],
    fee: 'Custom pricing',
  },
];

/** Marketing copy for the hero stat — not derived from GATEWAYS.length,
 * since it counts countries reachable across providers, not providers. */
export const COUNTRIES_SUPPORTED = '140+';

/** Looked up from GATEWAYS by key, not duplicated, so a top pick's rating or
 * colour can never silently drift from its own catalog entry. */
const TOP_PICK_KEYS: readonly string[] = ['stripe', 'paypal'];

export const TOP_PICKS: readonly GatewayListing[] = TOP_PICK_KEYS.map(
  (key) => GATEWAYS.find((g) => g.key === key)!,
);
