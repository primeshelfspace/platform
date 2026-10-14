import type { Brand } from '../database/client.js';
import type { AddressSnapshot, BrandSnapshot } from './contracts.js';

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
