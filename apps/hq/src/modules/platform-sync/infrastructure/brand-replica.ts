import { DEFAULT_BRAND_THEME_COLOR, type BrandSnapshot } from '@platform/platform-contracts';
import type { PrismaClient } from '../../database/client.js';

/** A transaction (or plain client) on the HQ database's OWNER role — the
 * application role holds SELECT only on the brand copy. */
export type ReplicaWriter = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Upserts one platform brand snapshot into HQ's read-only copy, unless the
 * stored copy is newer: snapshots carry the platform's updatedAt as their
 * version, and retries can reorder delivery. The one way the copy is written.
 */
export async function applyBrandSnapshot(tx: ReplicaWriter, brand: BrandSnapshot): Promise<void> {
  const incomingVersion = new Date(brand.updatedAt);
  const stored = await tx.brand.findUnique({
    where: { id: brand.id },
    select: { updatedAt: true },
  });
  if (stored && stored.updatedAt > incomingVersion) return;

  const fields = {
    merchantId: brand.merchantId,
    legalName: brand.legalName,
    displayName: brand.displayName,
    currency: brand.currency,
    timezone: brand.timezone,
    themeColor: brand.themeColor || DEFAULT_BRAND_THEME_COLOR,
    logoKey: brand.logoKey,
    status: brand.status,
    createdAt: new Date(brand.createdAt),
    updatedAt: incomingVersion,
    replicatedAt: new Date(),
  };
  await tx.brand.upsert({
    where: { id: brand.id },
    create: { id: brand.id, ...fields },
    update: fields,
  });
}
