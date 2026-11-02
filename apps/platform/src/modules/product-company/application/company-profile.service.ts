import { ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestScope } from '@platform/kernel';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { askingProduct } from '../../auth/application/product-access.js';

export interface CompanyDetails {
  readonly id: string;
  readonly companyName: string;
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly brandStructure: 'SINGLE' | 'MULTI' | null;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  /** The company email used at sign-up. */
  readonly contactEmail: string;
}

export interface ProductBrand {
  readonly id: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly currency: string;
  readonly timezone: string;
  /** Null when none has been set. */
  readonly themeColor: string | null;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly archived: boolean;
}

export interface CompanyProfile {
  readonly company: CompanyDetails;
  /** The Brands this user can access: all of them for the Company Admin,
   * otherwise only those assigned to the user. */
  readonly brands: ProductBrand[];
}

const BRAND_FIELDS = {
  id: true,
  legalName: true,
  displayName: true,
  currency: true,
  timezone: true,
  themeColor: true,
  status: true,
} as const;

/** A brand as the product APIs return it. */
export function toProductBrand(brand: {
  id: string;
  legalName: string;
  displayName: string;
  currency: string;
  timezone: string;
  themeColor: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}): ProductBrand {
  return { ...brand, archived: brand.status === 'ARCHIVED' };
}

/** Only the Company Admin has company-level access to every Brand. */
export const isCompanyAdmin = (scope: RequestScope) => scope.role === 'MERCHANT_OWNER';

/**
 * Company Profile — Company Details & Brands
 * (docs/product/stories/product-company-apis.md). Read-only; asked fresh each
 * time, so it always reflects the latest details and Brand access.
 */
@Injectable()
export class CompanyProfileService {
  constructor(private readonly prisma: PlatformPrismaService) {}

  async get(scope: RequestScope, companyId: string): Promise<CompanyProfile> {
    askingProduct(scope);
    // The JWT names the Company; any other id is refused, with nothing about it.
    if (companyId !== scope.merchantId) {
      throw new ForbiddenException({
        message: 'that is not your Company',
        code: 'NOT_YOUR_COMPANY',
      });
    }
    return this.prisma.withScope(scope, async (tx) => {
      const [merchant, brands] = await Promise.all([
        tx.merchant.findUniqueOrThrow({
          where: { id: scope.merchantId },
          select: {
            id: true,
            name: true,
            companyName: true,
            companyLegalName: true,
            companyTaxId: true,
            brandStructure: true,
            status: true,
            contactEmail: true,
          },
        }),
        tx.brand.findMany({
          where: {
            merchantId: scope.merchantId,
            ...(isCompanyAdmin(scope) ? {} : { assignments: { some: { userId: scope.userId } } }),
          },
          orderBy: { createdAt: 'asc' },
          select: BRAND_FIELDS,
        }),
      ]);
      return {
        company: {
          id: merchant.id,
          // Companies made before Register Your Company existed have only `name`.
          companyName: merchant.companyName ?? merchant.name,
          legalName: merchant.companyLegalName,
          taxId: merchant.companyTaxId,
          brandStructure: merchant.brandStructure,
          status: merchant.status,
          contactEmail: merchant.contactEmail,
        },
        brands: brands.map(toProductBrand),
      };
    });
  }
}
