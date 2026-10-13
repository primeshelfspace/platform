import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Brand } from '../database/client.js';
import type { BrandInput, Scope, StoragePort } from '@sugrpay/shared';
import { isPublicScope, storageKeys, STORAGE_PORT } from '@sugrpay/shared';
import {
  LOGO_URL_TTL_SECONDS,
  logoExtensionFor,
  storeLogo,
  type LogoUpload,
} from '../../common/logo-upload.js';
import { PlatformPrismaService } from '../database/platform-prisma.service.js';
import { PlatformOutbox } from '../events/platform-outbox.js';

export type BrandWithLogo = Brand & { readonly logoUrl: string | null };

/**
 * List is gated on BRANDS READ, which every role holds (FRS-001 §3.3) — the
 * row set itself is what narrows per role: RLS's `brand_scope` policy limits
 * `brand.findMany()` to the caller's merchant and, for anything short of an
 * all-brand role, to exactly the brands in their own `user_brand_assignment`
 * rows. So Owner/Merchant Admin see every brand in the merchant, and a Brand
 * Admin/Finance/Sales/Read Only user sees only what they are assigned —
 * without this handler doing any of that filtering itself.
 *
 * Create always targets the calling user's own merchant — a brand has no
 * meaning outside the tenant that owns it, and nothing in this app lets one
 * merchant create a brand for another.
 *
 * Every write records a platform.brand.* event in the same transaction and
 * flushes it after commit, so products holding a copy of the brand (invoicing)
 * see the change before this call returns.
 */
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly outbox: PlatformOutbox,
  ) {}

  async list(scope: Scope): Promise<BrandWithLogo[]> {
    const brands = await this.prisma.withScope(scope, (tx) =>
      tx.brand.findMany({ orderBy: { createdAt: 'asc' } }),
    );
    // Signed, not the raw key — logoKey is a storage-internal detail, and a
    // brand created straight from single-brand onboarding carries one across
    // from the staged company details before anyone has visited brand
    // settings, so this has to hold from the very first render, not just
    // after an explicit re-upload.
    return Promise.all(brands.map((brand) => this.withLogoUrl(brand)));
  }

  private async withLogoUrl(brand: Brand): Promise<BrandWithLogo> {
    if (!brand.logoKey) return { ...brand, logoUrl: null };
    const logoUrl = await this.storage.getSignedUrl(brand.logoKey, {
      expiresInSeconds: LOGO_URL_TTL_SECONDS,
    });
    return { ...brand, logoUrl };
  }

  /**
   * Creates the brand and announces it (platform.brand.created). Products set
   * up their own per-brand settings from that event — invoicing's invoice
   * prefix, for example, is saved through invoicing afterwards, never here.
   */
  async create(scope: Scope, input: BrandInput): Promise<Brand> {
    // A public (token-scoped) caller has no merchantId of its own to create
    // a brand under — this endpoint is never reachable that way today, but
    // the narrowing makes the invariant explicit rather than assumed.
    if (isPublicScope(scope)) {
      throw new Error('brand creation requires an authenticated merchant scope');
    }
    const brandFields = input;
    const merchantId = scope.merchantId;

    const brand = await this.prisma.withScope(scope, async (tx) => {
      const created = await tx.brand.create({
        data: {
          merchantId,
          legalName: brandFields.legalName,
          displayName: brandFields.displayName,
          businessType: brandFields.businessType,
          salesPerson: brandFields.salesPersonName,
          phone: brandFields.phone,
          email: brandFields.email,
          mailingAddress: brandFields.mailingAddress ?? undefined,
          billingAddress: brandFields.billingAddress ?? undefined,
          taxId: brandFields.taxId,
          currency: brandFields.currency,
          timezone: brandFields.timezone,
          themeColor: brandFields.themeColor,
        },
      });
      await this.outbox.recordBrand(tx, 'created', created);
      return created;
    });
    await this.outbox.flush();
    return brand;
  }

  /**
   * Brand Settings' "Brand Details" tab. Same full-object shape as create() —
   * see the controller's note on why a partial-patch schema isn't used here.
   *
   * mailingAddress/billingAddress use Prisma.DbNull rather than a bare
   * `undefined` fallback: unlike create() (where the column simply keeps its
   * schema default), `undefined` in an update's `data` means "leave whatever
   * is already stored alone" — clearing an address back to null needs an
   * explicit DbNull, or the old value would silently survive the "clear".
   */
  async update(scope: Scope, brandId: string, input: BrandInput): Promise<Brand> {
    const existing = await this.prisma.withScope(scope, (tx) =>
      tx.brand.findUnique({ where: { id: brandId } }),
    );
    if (!existing) throw new NotFoundException('brand not found');

    return this.updateAndPublish(scope, brandId, {
      legalName: input.legalName,
      displayName: input.displayName,
      businessType: input.businessType,
      salesPerson: input.salesPersonName,
      phone: input.phone,
      email: input.email,
      mailingAddress: input.mailingAddress ?? Prisma.DbNull,
      billingAddress: input.billingAddress ?? Prisma.DbNull,
      taxId: input.taxId,
      currency: input.currency,
      timezone: input.timezone,
      themeColor: input.themeColor,
    });
  }

  /**
   * The brand's primary colour, on its own — the invoicing Branding screens
   * edit it alongside invoicing's own settings. A no-op (no event, no
   * updatedAt bump) when the colour is unchanged.
   */
  async setThemeColor(scope: Scope, brandId: string, themeColor: string): Promise<Brand> {
    const existing = await this.prisma.withScope(scope, (tx) =>
      tx.brand.findUnique({ where: { id: brandId } }),
    );
    if (!existing) throw new NotFoundException('brand not found');
    if (existing.themeColor === themeColor) return existing;
    return this.updateAndPublish(scope, brandId, { themeColor });
  }

  private async updateAndPublish(
    scope: Scope,
    brandId: string,
    data: Prisma.BrandUpdateInput,
  ): Promise<Brand> {
    const brand = await this.prisma.withScope(scope, async (tx) => {
      const updated = await tx.brand.update({ where: { id: brandId }, data });
      await this.outbox.recordBrand(tx, 'updated', updated);
      return updated;
    });
    await this.outbox.flush();
    return brand;
  }

  /**
   * Uploaded outside any DB transaction on purpose: `put` is a network call
   * to S3 (or local disk), and `withScope` holds a real Postgres transaction
   * open for its whole callback — nothing external belongs inside that.
   */
  async setLogo(scope: Scope, brandId: string, file: LogoUpload): Promise<{ logoUrl: string }> {
    const extension = logoExtensionFor(file);

    const existing = await this.prisma.withScope(scope, (tx) =>
      tx.brand.findUnique({ where: { id: brandId } }),
    );
    if (!existing) throw new NotFoundException('brand not found');

    const key = storageKeys.brandLogo(brandId, `logo.${extension}`);
    const logoUrl = await storeLogo(this.storage, key, file);

    await this.updateAndPublish(scope, brandId, { logoKey: key });

    return { logoUrl };
  }
}
