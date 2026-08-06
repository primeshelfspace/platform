import type { CurrencyCode } from '../money/money.js';

/**
 * What a brand gets when nobody has said otherwise.
 *
 * These were previously literals scattered across the admin's create paths, so
 * "the default" was whatever the nearest file happened to say and changing it
 * meant finding every copy. They mirror the column defaults in schema.prisma —
 * that file is the source of truth for what the database will store; these
 * exist so the client sends the same thing deliberately rather than by
 * coincidence.
 */
export const DEFAULT_BRAND_CURRENCY: CurrencyCode = 'USD';
export const DEFAULT_BRAND_TIMEZONE = 'America/New_York';
export const DEFAULT_BRAND_THEME_COLOR = '#2D6A6A';
