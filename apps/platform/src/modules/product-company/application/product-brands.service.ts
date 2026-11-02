import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestScope } from '@platform/kernel';
import type { FirstBrandInput } from '@platform/platform-contracts';
import {
  PlatformPrismaService,
  type ScopedClient,
} from '../../database/platform-prisma.service.js';
import { PlatformOutbox } from '../../events/platform-outbox.js';
import { askingProduct } from '../../auth/application/product-access.js';
import { requireCompanyAdmin } from '../../companies/application/merchant.service.js';
import { toProductBrand, type ProductBrand } from './company-profile.service.js';

/** Brand Management's input: the same four required details and optional
 * Theme Color as Add Your Brand. */
export type ProductBrandInput = FirstBrandInput;

export interface AddedBrand {
  readonly id: string;
  readonly displayName: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}

/** Display Names compare without case or extra spaces. */
const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Brand Management — add, edit and archive Brands from a product
 * (docs/product/stories/product-company-apis.md). Company Admin only; acts on
 * the signed-in Company's Brands only. Every change is announced
 * (platform.brand.*) so products holding a copy of the Brand keep in step.
 * The Brand Structure chosen at registration does not limit how many Brands
 * there are.
 */
@Injectable()
export class ProductBrandsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly outbox: PlatformOutbox,
  ) {}

  async add(scope: RequestScope, input: ProductBrandInput): Promise<AddedBrand> {
    this.authorise(scope);
    const brand = await this.prisma.withScope(scope, async (tx) => {
      await this.lockCompany(tx, scope);
      await this.requireUniqueName(tx, scope, input.displayName);
      const created = await tx.brand.create({
        data: {
          merchantId: scope.merchantId,
          legalName: input.legalName,
          displayName: input.displayName,
          currency: input.currency,
          timezone: input.timezone,
          themeColor: input.themeColor ?? null,
          status: 'ACTIVE',
        },
      });
      await this.outbox.recordBrand(tx, 'created', created);
      return created;
    });
    await this.outbox.flush();
    return { id: brand.id, displayName: brand.displayName, status: brand.status };
  }

  /** The same rules as adding. Keeping the Brand's own Display Name is fine. */
  async edit(
    scope: RequestScope,
    brandId: string,
    input: ProductBrandInput,
  ): Promise<ProductBrand> {
    this.authorise(scope);
    const brand = await this.prisma.withScope(scope, async (tx) => {
      await this.lockCompany(tx, scope);
      await this.requireBrand(tx, scope, brandId);
      await this.requireUniqueName(tx, scope, input.displayName, brandId);
      const updated = await tx.brand.update({
        where: { id: brandId },
        data: {
          legalName: input.legalName,
          displayName: input.displayName,
          currency: input.currency,
          timezone: input.timezone,
          themeColor: input.themeColor ?? null,
        },
      });
      await this.outbox.recordBrand(tx, 'updated', updated);
      return updated;
    });
    await this.outbox.flush();
    return toProductBrand(brand);
  }

  /** Marks the Brand archived. Archiving one already archived changes nothing. */
  async archive(scope: RequestScope, brandId: string): Promise<ProductBrand> {
    this.authorise(scope);
    const brand = await this.prisma.withScope(scope, async (tx) => {
      const existing = await this.requireBrand(tx, scope, brandId);
      if (existing.status === 'ARCHIVED') return existing;
      const updated = await tx.brand.update({
        where: { id: brandId },
        data: { status: 'ARCHIVED' },
      });
      await this.outbox.recordBrand(tx, 'updated', updated);
      return updated;
    });
    await this.outbox.flush();
    return toProductBrand(brand);
  }

  private authorise(scope: RequestScope): void {
    askingProduct(scope);
    requireCompanyAdmin(scope);
  }

  /** Serialises Brand writes per Company, so two adds cannot both pass the
   * Display Name check. */
  private async lockCompany(tx: ScopedClient, scope: RequestScope): Promise<void> {
    await tx.$queryRaw`SELECT id FROM merchant WHERE id = ${scope.merchantId}::uuid FOR UPDATE`;
  }

  private async requireBrand(tx: ScopedClient, scope: RequestScope, brandId: string) {
    const brand = await tx.brand.findFirst({
      where: { id: brandId, merchantId: scope.merchantId },
    });
    // A Brand of another Company is simply not found: nothing about it is told.
    if (!brand) throw new NotFoundException('brand not found');
    return brand;
  }

  private async requireUniqueName(
    tx: ScopedClient,
    scope: RequestScope,
    displayName: string,
    exceptBrandId?: string,
  ): Promise<void> {
    const brands = await tx.brand.findMany({
      where: {
        merchantId: scope.merchantId,
        ...(exceptBrandId ? { id: { not: exceptBrandId } } : {}),
      },
      select: { displayName: true },
    });
    if (brands.some((b) => nameKey(b.displayName) === nameKey(displayName))) {
      const message = 'another Brand in your Company already has this Display Name';
      throw new ConflictException({
        message,
        code: 'DISPLAY_NAME_TAKEN',
        issues: [{ path: 'displayName', message, code: 'DISPLAY_NAME_TAKEN' }],
      });
    }
  }
}
