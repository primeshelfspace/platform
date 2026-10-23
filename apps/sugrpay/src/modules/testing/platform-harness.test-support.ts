/**
 * Test support for Sugrpay tests that need "the platform" beside them: a
 * company and its brands, the audit log, a brand colour change.
 *
 * Since the APIs were split, Sugrpay's tests never touch the platform's
 * database. A brand is written into Sugrpay's own brand copy exactly as a
 * platform event would write it (through the real applyBrandSnapshot), and the
 * calls Sugrpay makes to the platform API (audit entries, brand colour) are
 * recorded in memory so tests can assert on them. The platform's side of those
 * calls is tested in apps/platform; the HTTP between them in the e2e suite.
 */
import { randomUUID } from 'node:crypto';
import type { Scope } from '@platform/kernel';
import { InvoicingPrismaService } from '../database/invoicing-prisma.service.js';
import type { AuditEntry, AuditLogService, BrandsService } from '../platform-access/index.js';
import { createInvoicingBrand, deleteInvoicingBrand } from './brand-fixture.test-support.js';

export interface RecordedAudit {
  readonly scope: Scope;
  readonly entry: AuditEntry;
}

export interface PlatformHarness {
  /** Stand-in for the platform's audit log; every entry lands in `auditEntries`. */
  readonly audit: AuditLogService;
  readonly auditEntries: RecordedAudit[];
  /** Stand-in for the platform's brands: a colour change reaches Sugrpay's
   * brand copy at once, as the brand-updated event would. */
  readonly brands: BrandsService;
  /** A fresh company id (companies live in the platform; Sugrpay only ever
   * sees their ids). */
  createMerchant(name: string): Promise<string>;
  /** Removes Sugrpay's copies of the given brands and their data. */
  deleteMerchant(merchantId: string, brandIds: readonly string[]): Promise<void>;
  /** A brand in Sugrpay's copy, with its default settings. */
  createBrand(
    merchantId: string,
    displayName: string,
    themeColor?: string,
  ): Promise<{ id: string; merchantId: string; themeColor: string }>;
  deleteBrand(brandId: string): Promise<void>;
  close(): Promise<void>;
}

export function createPlatformHarness(invoicing: InvoicingPrismaService): PlatformHarness {
  const auditEntries: RecordedAudit[] = [];
  const audit = {
    record: async (scope: Scope, entry: AuditEntry) => {
      auditEntries.push({ scope, entry });
    },
  } as unknown as AuditLogService;
  const brands = {
    setThemeColor: async (_scope: Scope, brandId: string, themeColor: string) => {
      await invoicing.ownerClient.brand.update({ where: { id: brandId }, data: { themeColor } });
    },
  } as unknown as BrandsService;

  return {
    audit,
    auditEntries,
    brands,
    createMerchant: async () => randomUUID(),
    async deleteMerchant(_merchantId, brandIds) {
      await invoicing.withoutScope('test teardown', async (client) => {
        for (const brandId of brandIds) await deleteInvoicingBrand(client, brandId);
      });
    },
    async createBrand(merchantId, displayName, themeColor = '#2D6A6A') {
      const brand = await createInvoicingBrand(invoicing.ownerClient, { displayName, merchantId });
      if (themeColor !== '#2D6A6A') {
        await invoicing.ownerClient.brand.update({ where: { id: brand.id }, data: { themeColor } });
      }
      return { ...brand, themeColor };
    },
    async deleteBrand(brandId) {
      await invoicing.withoutScope('test teardown', (client) =>
        deleteInvoicingBrand(client, brandId),
      );
    },
    async close() {
      // Nothing of its own to close: the invoicing connection belongs to the test.
    },
  };
}
