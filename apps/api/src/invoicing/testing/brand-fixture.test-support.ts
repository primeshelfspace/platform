/**
 * Test support: a brand that exists only on invoicing's side — for invoicing
 * tests that mock the platform and just need somewhere for customers and
 * invoices to live. Written with the same applyBrandSnapshot the live
 * platform.brand.* events use, so it is shaped exactly like a real copy
 * (settings row included). Use createPlatformHarness instead when the test
 * needs the platform's brand too.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../database/client.js';
import { applyBrandSnapshot } from '../platform-sync/brand-replica.js';

export async function createInvoicingBrand(
  owner: PrismaClient,
  input: { readonly displayName: string; readonly merchantId?: string },
): Promise<{ id: string; merchantId: string }> {
  const now = new Date().toISOString();
  const brand = {
    id: randomUUID(),
    merchantId: input.merchantId ?? randomUUID(),
    legalName: input.displayName,
    displayName: input.displayName,
    salesPerson: null,
    businessType: null,
    phone: null,
    email: null,
    mailingAddress: null,
    billingAddress: null,
    taxId: null,
    currency: 'USD',
    timezone: 'America/New_York',
    themeColor: '#2D6A6A',
    logoKey: null,
    status: 'ACTIVE' as const,
    createdAt: now,
    updatedAt: now,
  };
  await applyBrandSnapshot(owner, brand);
  return { id: brand.id, merchantId: brand.merchantId };
}

/**
 * Removes an invoicing-side brand and everything under it. Payments and an
 * invoice's customer are RESTRICT references (financial records are never
 * cascaded away in normal operation), so they are removed explicitly, in
 * dependency order, before the brand.
 */
export async function deleteInvoicingBrand(owner: PrismaClient, brandId: string): Promise<void> {
  await owner.payment.deleteMany({ where: { brandId } });
  await owner.invoice.deleteMany({ where: { brandId } });
  await owner.customer.deleteMany({ where: { brandId } });
  await owner.brand.deleteMany({ where: { id: brandId } });
}
