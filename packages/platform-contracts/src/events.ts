/**
 * Events the platform publishes — a published contract, like an API. Other
 * modules depend on these shapes, so change them additively: new optional
 * fields are fine; renaming or removing one needs every subscriber updated
 * first.
 *
 * Published by the platform API; delivered to Sugrpay over HTTP (POST /internal/events).
 */

export const PLATFORM_EVENTS = {
  /** A brand was created. Payload: BrandEventPayload. */
  brandCreated: 'platform.brand.created',
  /** Any brand field changed, including status (archive/unarchive) and logo.
   * Payload: BrandEventPayload, always the complete current brand. */
  brandUpdated: 'platform.brand.updated',
  /** A product was switched on or off for a company. Payload: SubscriptionEventPayload. */
  subscriptionChanged: 'platform.subscription.changed',
  /** A location was created. Payload: LocationEventPayload. */
  locationCreated: 'platform.location.created',
  /** Any location field changed, including status. Payload: LocationEventPayload. */
  locationUpdated: 'platform.location.updated',
} as const;

export type PlatformEventTopic = (typeof PLATFORM_EVENTS)[keyof typeof PLATFORM_EVENTS];

/** JSON-safe postal address, as stored on the brand. */
export type AddressSnapshot = Record<string, unknown>;

/**
 * The complete brand as of the event. Subscribers keep their own copy of
 * whatever fields they need (rule: copy what you need to keep) and should
 * ignore a snapshot whose `updatedAt` is older than the one they hold —
 * delivery order is not guaranteed across retries.
 */
export interface BrandSnapshot {
  readonly id: string;
  readonly merchantId: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly salesPerson: string | null;
  readonly businessType:
    'SOLE_PROPRIETORSHIP' | 'LLC' | 'CORPORATION' | 'PARTNERSHIP' | 'NONPROFIT' | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly mailingAddress: AddressSnapshot | null;
  readonly billingAddress: AddressSnapshot | null;
  readonly taxId: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly themeColor: string;
  readonly logoKey: string | null;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  /** ISO 8601. */
  readonly createdAt: string;
  /** ISO 8601 — also the snapshot's version. */
  readonly updatedAt: string;
}

export interface BrandEventPayload {
  readonly brand: BrandSnapshot;
}

export interface SubscriptionSnapshot {
  readonly id: string;
  readonly merchantId: string;
  readonly product: 'INVOICING' | 'HQ';
  readonly status: 'ACTIVE' | 'CANCELLED';
  readonly plan: string;
  /** ISO 8601. */
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** ISO 8601 — also the snapshot's version. */
  readonly updatedAt: string;
}

export interface SubscriptionEventPayload {
  readonly subscription: SubscriptionSnapshot;
}

/** The complete location as of the event; same versioning rule as brands. */
export interface LocationSnapshot {
  readonly id: string;
  readonly merchantId: string;
  readonly brandId: string | null;
  readonly name: string;
  readonly kind: 'STORE' | 'WAREHOUSE';
  readonly address: AddressSnapshot | null;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  /** ISO 8601. */
  readonly createdAt: string;
  /** ISO 8601 — also the snapshot's version. */
  readonly updatedAt: string;
}

export interface LocationEventPayload {
  readonly location: LocationSnapshot;
}
