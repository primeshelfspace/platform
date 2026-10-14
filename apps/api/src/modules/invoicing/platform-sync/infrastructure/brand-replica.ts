import type { BrandSnapshot } from '../../../platform/public-api.js';
import { Prisma, type PrismaClient } from '../../database/client.js';

/** A transaction (or plain client) on the invoicing database's OWNER role —
 * the application role holds SELECT only on the brand copy. */
export type ReplicaWriter = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Upserts one platform brand snapshot into invoicing's read-only copy —
 * unless the stored copy is newer (snapshots carry the platform's updatedAt
 * as their version, and retries can reorder delivery) — and makes sure the
 * brand has invoicing's own settings row, which it needs before it can issue
 * its first invoice.
 *
 * The one way the copy is ever written: BrandReplicaProjector calls it for
 * live events, and the seed and the legacy-data migration call it too, so
 * every path builds the copy identically.
 */
export async function applyBrandSnapshot(tx: ReplicaWriter, brand: BrandSnapshot): Promise<void> {
  const incomingVersion = new Date(brand.updatedAt);
  const stored = await tx.brand.findUnique({
    where: { id: brand.id },
    select: { updatedAt: true },
  });

  if (!stored || stored.updatedAt <= incomingVersion) {
    const fields = {
      merchantId: brand.merchantId,
      legalName: brand.legalName,
      displayName: brand.displayName,
      salesPerson: brand.salesPerson,
      businessType: brand.businessType,
      phone: brand.phone,
      email: brand.email,
      taxId: brand.taxId,
      currency: brand.currency,
      timezone: brand.timezone,
      themeColor: brand.themeColor,
      logoKey: brand.logoKey,
      status: brand.status,
      createdAt: new Date(brand.createdAt),
      updatedAt: incomingVersion,
      replicatedAt: new Date(),
    };
    await tx.brand.upsert({
      where: { id: brand.id },
      create: {
        id: brand.id,
        ...fields,
        mailingAddress: (brand.mailingAddress ?? undefined) as Prisma.InputJsonValue | undefined,
        billingAddress: (brand.billingAddress ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      update: {
        ...fields,
        // A cleared address must clear the copy too, not leave the old value.
        mailingAddress: (brand.mailingAddress as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
        billingAddress: (brand.billingAddress as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
      },
    });
  }

  await tx.brandSettings.upsert({
    where: { brandId: brand.id },
    create: { brandId: brand.id },
    update: {},
  });
}
