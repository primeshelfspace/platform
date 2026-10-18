/**
 * Test support for invoicing tests that need the real platform beside them —
 * a platform-owned brand, the platform's audit log, or a brand change that
 * must reach invoicing's copy through the real event path.
 *
 * Wires the platform services the way the application does (platform
 * database, outbox, dispatcher) and subscribes invoicing's real
 * BrandReplicaProjector, so a brand created or changed here arrives in the
 * invoicing database exactly as it does in production.
 *
 * Test-only: the module-boundary rule lets *.test-support.ts files reach
 * platform internals for fixtures; production invoicing code never does.
 */
import type { RequestScope, StoragePort } from '@platform/shared';
import { LocalDiskAdapter } from '../../../shared/adapters/storage/local-disk.adapter.js';
import type { Env } from '../../../shared/config/env.js';
import { EventBus } from '../../../shared/infra/events/event-bus.js';
import { OutboxDispatcher } from '../../../shared/infra/events/outbox-dispatcher.js';
import { AuditLogService } from '../../platform/audit/application/audit-log.service.js';
import { BrandsService } from '../../platform/brands/application/brands.service.js';
import { PrismaClient as PlatformClient, type Brand } from '../../platform/database/client.js';
import { PlatformPrismaService } from '../../platform/database/platform-prisma.service.js';
import { PlatformOutbox } from '../../platform/events/platform-outbox.js';
import { InvoicingPrismaService } from '../database/invoicing-prisma.service.js';
import { BrandReplicaProjector } from '../platform-sync/application/brand-replica.projector.js';
import { deleteInvoicingBrand } from './brand-fixture.test-support.js';

export interface PlatformHarness {
  /** Owner connection to the platform database, for fixtures and assertions. */
  readonly owner: PlatformClient;
  /** The platform's own database service, for constructing platform services. */
  readonly prisma: PlatformPrismaService;
  /** A fresh merchant (company) in the platform database. */
  createMerchant(name: string): Promise<string>;
  /** Removes a merchant (cascading its brands and connections in the
   * platform) and the invoicing copies of the given brands. */
  deleteMerchant(merchantId: string, brandIds: readonly string[]): Promise<void>;
  readonly brands: BrandsService;
  readonly audit: AuditLogService;
  readonly dispatcher: OutboxDispatcher;
  /** Creates a brand the way the platform does (event included) and waits
   * for invoicing's copy and default settings to exist. */
  createBrand(merchantId: string, displayName: string, themeColor?: string): Promise<Brand>;
  /** Removes a brand from both databases. */
  deleteBrand(brandId: string): Promise<void>;
  close(): Promise<void>;
}

export function createPlatformHarness(
  env: Env,
  invoicing: InvoicingPrismaService,
  storage: StoragePort = new LocalDiskAdapter(env),
): PlatformHarness {
  const platformPrisma = new PlatformPrismaService(env);
  const bus = new EventBus();
  const dispatcher = new OutboxDispatcher(bus, env);
  new BrandReplicaProjector(bus, invoicing).onModuleInit();
  const outbox = new PlatformOutbox(platformPrisma, dispatcher);
  const brands = new BrandsService(platformPrisma, storage, outbox);
  const audit = new AuditLogService(platformPrisma);
  const owner = new PlatformClient({
    datasources: { db: { url: env.PLATFORM_DIRECT_DATABASE_URL ?? env.PLATFORM_DATABASE_URL } },
  });

  const ownerScope = (merchantId: string): RequestScope => ({
    merchantId,
    userId: '00000000-0000-0000-0000-000000000001',
    role: 'MERCHANT_OWNER',
    assignedBrandIds: [],
    sessionId: 'test-harness',
    sourceIp: null,
  });

  return {
    owner,
    prisma: platformPrisma,
    brands,
    audit,
    dispatcher,
    async createMerchant(name) {
      const merchant = await owner.merchant.create({
        data: { name, contactEmail: 'ops@example.com' },
      });
      return merchant.id;
    },
    async deleteMerchant(merchantId, brandIds) {
      await invoicing.withoutScope('test teardown', async (client) => {
        for (const brandId of brandIds) await deleteInvoicingBrand(client, brandId);
      });
      await owner.merchant.deleteMany({ where: { id: merchantId } });
    },
    createBrand: (merchantId, displayName, themeColor = '#2D6A6A') =>
      brands.create(ownerScope(merchantId), {
        legalName: `${displayName} Ltd.`,
        displayName,
        businessType: 'LLC',
        salesPersonName: null,
        phone: null,
        email: null,
        mailingAddress: null,
        billingAddress: null,
        taxId: null,
        currency: 'USD',
        timezone: 'America/New_York',
        themeColor,
      }),
    async deleteBrand(brandId) {
      await invoicing.withoutScope('test teardown', (client) =>
        deleteInvoicingBrand(client, brandId),
      );
      await owner.brand.deleteMany({ where: { id: brandId } });
    },
    async close() {
      await Promise.all([platformPrisma.$disconnect(), owner.$disconnect()]);
    },
  };
}
