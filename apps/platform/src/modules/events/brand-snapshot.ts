import type { Brand, Location, Subscription } from '../database/client.js';
import type {
  AddressSnapshot,
  BrandSnapshot,
  LocationSnapshot,
  SubscriptionSnapshot,
} from './contracts.js';

/** The complete brand, as published in platform.brand.* events. */
export function toBrandSnapshot(brand: Brand): BrandSnapshot {
  return {
    id: brand.id,
    merchantId: brand.merchantId,
    legalName: brand.legalName,
    displayName: brand.displayName,
    salesPerson: brand.salesPerson,
    businessType: brand.businessType,
    phone: brand.phone,
    email: brand.email,
    mailingAddress: (brand.mailingAddress as AddressSnapshot | null) ?? null,
    billingAddress: (brand.billingAddress as AddressSnapshot | null) ?? null,
    taxId: brand.taxId,
    currency: brand.currency,
    timezone: brand.timezone,
    themeColor: brand.themeColor,
    logoKey: brand.logoKey,
    status: brand.status,
    createdAt: brand.createdAt.toISOString(),
    updatedAt: brand.updatedAt.toISOString(),
  };
}

/** The complete subscription, as published in platform.subscription.changed. */
export function toSubscriptionSnapshot(subscription: Subscription): SubscriptionSnapshot {
  return {
    id: subscription.id,
    merchantId: subscription.merchantId,
    product: subscription.product,
    status: subscription.status,
    plan: subscription.plan,
    startedAt: subscription.startedAt.toISOString(),
    endedAt: subscription.endedAt?.toISOString() ?? null,
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

/** The complete location, as published in platform.location.* events. */
export function toLocationSnapshot(location: Location): LocationSnapshot {
  return {
    id: location.id,
    merchantId: location.merchantId,
    brandId: location.brandId,
    name: location.name,
    kind: location.kind,
    address: (location.address as AddressSnapshot | null) ?? null,
    status: location.status,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}
