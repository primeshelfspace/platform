import { Injectable } from '@nestjs/common';
import { PRODUCTS, type Product, type RequestScope } from '@platform/kernel';
import type { UpdateSubscriptionInput } from '@platform/platform-contracts';
import type { Subscription } from '../../database/client.js';
import {
  PlatformPrismaService,
  type ScopedClient,
} from '../../database/platform-prisma.service.js';
import { PlatformOutbox } from '../../events/platform-outbox.js';
import { requireReadyForProducts } from '../../companies/application/merchant.service.js';

/** One entry per product, whether or not the company has ever subscribed. */
export interface ProductSubscription {
  readonly product: Product;
  readonly status: 'ACTIVE' | 'CANCELLED' | 'NONE';
  readonly plan: string | null;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
}

/**
 * Which products a company has switched on (architecture plan, phase 2).
 *
 * A product's endpoints refuse a company without an ACTIVE subscription — the
 * AuthorisationGuard reads that from the session, so a change here takes
 * effect on the very next request. Billing is not connected yet: this is the
 * manual on/off an owner uses, and the place a billing provider's webhook will
 * call later.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly outbox: PlatformOutbox,
  ) {}

  async list(scope: RequestScope): Promise<ProductSubscription[]> {
    const rows = await this.prisma.withScope(scope, (tx) => tx.subscription.findMany());
    return PRODUCTS.map((product) => toProductSubscription(product, rows));
  }

  async update(
    scope: RequestScope,
    product: Product,
    input: UpdateSubscriptionInput,
  ): Promise<ProductSubscription> {
    const saved = await this.prisma.withScope(scope, async (tx) => {
      // Switching a product on is enabling it: not before Register Your
      // Company and Add Your Brand, and it completes onboarding.
      if (input.status === 'ACTIVE') {
        await requireReadyForProducts(tx, scope.merchantId);
        await tx.merchant.update({
          where: { id: scope.merchantId },
          data: { onboardingComplete: true },
        });
      }
      const subscription = await this.save(tx, scope.merchantId, product, input);
      await this.outbox.recordSubscription(tx, subscription);
      return subscription;
    });
    await this.outbox.flush();
    return toProductSubscription(product, [saved]);
  }

  /** Creates or updates the company's subscription to one product. */
  async save(
    tx: ScopedClient,
    merchantId: string,
    product: Product,
    input: Pick<UpdateSubscriptionInput, 'status'> & Partial<UpdateSubscriptionInput>,
  ): Promise<Subscription> {
    const active = input.status === 'ACTIVE';
    const existing = await tx.subscription.findUnique({
      where: { merchantId_product: { merchantId, product } },
    });
    if (!existing) {
      return tx.subscription.create({
        data: {
          merchantId,
          product,
          status: input.status,
          plan: input.plan ?? 'standard',
          endedAt: active ? null : new Date(),
        },
      });
    }
    const reactivated = active && existing.status !== 'ACTIVE';
    return tx.subscription.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        ...(input.plan ? { plan: input.plan } : {}),
        ...(reactivated ? { startedAt: new Date(), endedAt: null } : {}),
        ...(!active && existing.status === 'ACTIVE' ? { endedAt: new Date() } : {}),
      },
    });
  }
}

function toProductSubscription(product: Product, rows: Subscription[]): ProductSubscription {
  const row = rows.find((r) => r.product === product);
  return {
    product,
    status: row?.status ?? 'NONE',
    plan: row?.plan ?? null,
    startedAt: row?.startedAt ?? null,
    endedAt: row?.endedAt ?? null,
  };
}
