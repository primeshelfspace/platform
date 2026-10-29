import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestScope } from '@platform/kernel';
import type {
  FirstBrandInput,
  OnboardingStep,
  RegisterCompanyInput,
} from '@platform/platform-contracts';
import {
  PlatformPrismaService,
  type ScopedClient,
} from '../../database/platform-prisma.service.js';
import { PlatformOutbox } from '../../events/platform-outbox.js';

export interface MerchantOnboardingState {
  /** Where onboarding stands; the web app opens this step's screen. */
  readonly nextStep: OnboardingStep;
  readonly onboardingComplete: boolean;
  /** Register Your Company, once done. */
  readonly company: {
    readonly companyName: string | null;
    readonly legalName: string | null;
    readonly taxId: string | null;
    readonly contactEmail: string;
    readonly brandStructure: 'SINGLE' | 'MULTI' | null;
    readonly registeredAt: Date | null;
  };
  readonly hasBrands: boolean;
}

export interface CreatedBrandSummary {
  readonly id: string;
  readonly displayName: string;
}

/** A 409 a client can act on: `code` says which rule, `issues` which field. */
function conflict(code: string, message: string, path?: string): ConflictException {
  return new ConflictException({
    message,
    code,
    ...(path ? { issues: [{ path, message, code }] } : {}),
  });
}

/** The Company Name compared for uniqueness: lower-cased, single spaces. */
export function companyNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Where a company's onboarding stands, from its data alone (never stored, so
 * it cannot drift): Register Your Company, then Add Your Brand, then Select
 * Your Products. A company that has completed onboarding stays on Select Your
 * Products, the screen every user sees after signing in.
 */
export async function onboardingStepFor(
  tx: ScopedClient,
  merchantId: string,
): Promise<OnboardingStep> {
  const [merchant, activeBrands] = await Promise.all([
    tx.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { registeredAt: true, onboardingComplete: true },
    }),
    tx.brand.count({ where: { merchantId, status: 'ACTIVE' } }),
  ]);
  if (merchant.onboardingComplete) return 'SELECT_PRODUCTS';
  if (!merchant.registeredAt) return 'REGISTER_COMPANY';
  if (activeBrands === 0) return 'ADD_BRAND';
  return 'SELECT_PRODUCTS';
}

/** Products are enabled only after Register Your Company and Add Your Brand.
 * Also guards the plan-and-billing toggle, so neither route skips a step. */
export async function requireReadyForProducts(tx: ScopedClient, merchantId: string): Promise<void> {
  const step = await onboardingStepFor(tx, merchantId);
  if (step === 'REGISTER_COMPANY') {
    throw conflict('COMPANY_NOT_REGISTERED', 'register the company before enabling products');
  }
  if (step === 'ADD_BRAND') {
    throw conflict('ADD_BRAND_FIRST', 'add a brand before enabling products');
  }
}

/** Only the Company Admin (the person who signed up: MERCHANT_OWNER) runs
 * onboarding. Checked here as well as by the route's permission, because
 * the story's rule is narrower than the BRANDS permission. */
export function requireCompanyAdmin(scope: RequestScope): void {
  if (scope.role !== 'MERCHANT_OWNER') {
    throw new ForbiddenException('only the Company Admin can do this');
  }
}

/**
 * Company onboarding, the platform side of Register Your Company and Add Your
 * Brand (docs/product/stories/company-onboarding.md). Select Your Products is
 * ProductsService. Every step checks the ones before it here, on the server,
 * so a step cannot be skipped by calling the API directly.
 */
@Injectable()
export class MerchantService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly outbox: PlatformOutbox,
  ) {}

  async getOnboardingState(scope: RequestScope): Promise<MerchantOnboardingState> {
    return this.prisma.withScope(scope, async (tx) => {
      const [merchant, brandCount, nextStep] = await Promise.all([
        tx.merchant.findUniqueOrThrow({ where: { id: scope.merchantId } }),
        tx.brand.count({ where: { merchantId: scope.merchantId } }),
        onboardingStepFor(tx, scope.merchantId),
      ]);
      return {
        nextStep,
        onboardingComplete: merchant.onboardingComplete,
        company: {
          companyName: merchant.companyName,
          legalName: merchant.companyLegalName,
          taxId: merchant.companyTaxId,
          contactEmail: merchant.companyEmail ?? merchant.contactEmail,
          brandStructure: merchant.brandStructure,
          registeredAt: merchant.registeredAt,
        },
        hasBrands: brandCount > 0,
      };
    });
  }

  /**
   * Register Your Company. Once per company: a registered company is left
   * exactly as it is. The Company Name is unique across every company,
   * ignoring case and repeated spaces; the unique index on company_name_key
   * is what decides, so two registrations racing for one name cannot both
   * win. The contact email is the sign-up email, set at sign-up.
   */
  async registerCompany(
    scope: RequestScope,
    input: RegisterCompanyInput,
  ): Promise<{ nextStep: OnboardingStep }> {
    requireCompanyAdmin(scope);
    try {
      await this.prisma.withScope(scope, async (tx) => {
        const merchant = await tx.merchant.findUniqueOrThrow({
          where: { id: scope.merchantId },
          select: { registeredAt: true },
        });
        if (merchant.registeredAt) {
          throw conflict('COMPANY_ALREADY_REGISTERED', 'this company is already registered');
        }
        await tx.merchant.update({
          where: { id: scope.merchantId },
          data: {
            name: input.companyName,
            companyName: input.companyName,
            companyNameKey: companyNameKey(input.companyName),
            companyLegalName: input.legalName,
            companyTaxId: input.taxId,
            brandStructure: input.brandStructure,
            registeredAt: new Date(),
          },
        });
      });
    } catch (error) {
      // company_name_key is the only unique column this update writes, and
      // Prisma reports the target differently by version, so any unique
      // violation here is the name.
      if (PlatformPrismaService.isUniqueViolation(error)) {
        throw conflict(
          'COMPANY_NAME_TAKEN',
          'a company with this name is already registered',
          'companyName',
        );
      }
      throw error;
    }
    return { nextStep: 'ADD_BRAND' };
  }

  /**
   * Add Your Brand: the company's first brand, active. Only after Register
   * Your Company, and only one in this step whichever brand structure was
   * chosen — more brands come later from Brand Management. The brand's email
   * and tax ID are the company's. Every product hears about the brand
   * (brand.created) before this returns, so it is ready wherever the user
   * goes next.
   */
  async addFirstBrand(
    scope: RequestScope,
    input: FirstBrandInput,
  ): Promise<{ brand: CreatedBrandSummary; nextStep: OnboardingStep }> {
    requireCompanyAdmin(scope);
    const brand = await this.prisma.withScope(scope, async (tx) => {
      // Locks the company row: two submits at once cannot both see "no brand".
      const [merchant] = await tx.$queryRaw<
        Array<{
          registered_at: Date | null;
          company_email: string | null;
          company_tax_id: string | null;
        }>
      >`SELECT registered_at, company_email, company_tax_id FROM merchant
        WHERE id = ${scope.merchantId}::uuid FOR UPDATE`;
      if (!merchant?.registered_at) {
        throw conflict('COMPANY_NOT_REGISTERED', 'register the company before adding a brand');
      }
      const existing = await tx.brand.count({ where: { merchantId: scope.merchantId } });
      if (existing > 0) {
        throw conflict(
          'BRAND_ALREADY_ADDED',
          'this company already has a brand; add more from Brand Management',
        );
      }
      const created = await tx.brand.create({
        data: {
          merchantId: scope.merchantId,
          legalName: input.legalName,
          displayName: input.displayName,
          currency: input.currency,
          timezone: input.timezone,
          // Left out: the column's default colour.
          ...(input.themeColor ? { themeColor: input.themeColor } : {}),
          email: merchant.company_email,
          taxId: merchant.company_tax_id,
          status: 'ACTIVE',
        },
      });
      await this.outbox.recordBrand(tx, 'created', created);
      return created;
    });
    await this.outbox.flush();
    return {
      brand: { id: brand.id, displayName: brand.displayName },
      nextStep: 'SELECT_PRODUCTS',
    };
  }
}
