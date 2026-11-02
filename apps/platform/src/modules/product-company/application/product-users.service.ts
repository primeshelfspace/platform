import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import {
  assignableProductRoles,
  type Product,
  type RequestScope,
  type Role,
} from '@platform/kernel';
import type {
  ProductUserEditInput,
  ProductUserInput,
  ProductUserListQuery,
} from '@platform/platform-contracts';
import { Prisma } from '../../database/client.js';
import {
  PlatformPrismaService,
  type ScopedClient,
} from '../../database/platform-prisma.service.js';
import { askingProduct, roleInProduct } from '../../auth/application/product-access.js';
import { SessionService } from '../../auth/application/session.service.js';
import { hashPassword } from '../../auth/infrastructure/password.js';
import { requireCompanyAdmin } from '../../companies/application/merchant.service.js';

export interface ProductUserPhone {
  /** ISO 3166 alpha-2, e.g. "US". */
  readonly country: string;
  /** The dialling code, e.g. "+1". */
  readonly countryCode: string;
  /** The national number, digits only. */
  readonly number: string;
  /** The full number, E.164. */
  readonly e164: string;
}

export interface ProductUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** Null for accounts made before phones were recorded (e.g. at sign-up). */
  readonly phone: ProductUserPhone | null;
  /** COMPANY_ADMIN for the Company Admin; otherwise the role in the asking
   * product only, or null when they hold none there. */
  readonly role: string | null;
  /** All of the Company's Brands for the Company Admin; otherwise the Brands
   * assigned to the user. */
  readonly brands: {
    readonly id: string;
    readonly displayName: string;
    readonly archived: boolean;
  }[];
  readonly status: 'ACTIVE' | 'INVITED' | 'DEACTIVATED';
}

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phoneCountry: true,
  phoneNumber: true,
  role: true,
  status: true,
  productRoles: { select: { product: true, role: true } },
  assignments: { select: { brandId: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;
type BrandRow = { id: string; displayName: string; status: 'ACTIVE' | 'ARCHIVED' };

function fieldError(
  kind: 'bad' | 'conflict',
  code: string,
  path: string,
  message: string,
): BadRequestException | ConflictException {
  const body = { message, code, issues: [{ path, message, code }] };
  return kind === 'bad' ? new BadRequestException(body) : new ConflictException(body);
}

function phoneOf(country: string | null, e164: string | null): ProductUserPhone | null {
  if (!country || !e164) return null;
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return null;
  return {
    country,
    countryCode: `+${parsed.countryCallingCode}`,
    number: parsed.nationalNumber,
    e164,
  };
}

/**
 * User Management — Users, Roles & Access, and User List
 * (docs/product/stories/product-company-apis.md). Company Admin only; acts on
 * the signed-in Company's users only. Roles are the asking product's own
 * (Role List); Brands are the Company's.
 */
@Injectable()
export class ProductUsersService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly sessions: SessionService,
  ) {}

  /** The Company's users, optionally only those assigned to one Brand (the
   * Company Admin is under every Brand). Deactivated users are included. */
  async list(scope: RequestScope, query: ProductUserListQuery): Promise<ProductUser[]> {
    const product = this.authorise(scope);
    return this.prisma.withScope(scope, async (tx) => {
      const brands = await this.companyBrands(tx, scope);
      if (query.brandId && !brands.some((b) => b.id === query.brandId)) {
        throw new NotFoundException('brand not found');
      }
      const users = await tx.user.findMany({
        where: {
          merchantId: scope.merchantId,
          ...(query.brandId
            ? {
                OR: [
                  { role: 'MERCHANT_OWNER' },
                  { assignments: { some: { brandId: query.brandId } } },
                ],
              }
            : {}),
        },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
        select: USER_SELECT,
      });
      return users.map((user) => this.present(user, product, brands));
    });
  }

  async add(scope: RequestScope, input: ProductUserInput): Promise<ProductUser> {
    const product = this.authorise(scope);
    const role = this.requireAssignableRole(product, input.role);
    const phone = this.requireValidPhone(input.phone);
    const passwordHash = await hashPassword(input.password);
    return this.prisma.withScope(scope, async (tx) => {
      const brands = await this.companyBrands(tx, scope);
      const brandIds = this.requireCompanyBrands(brands, input.brandIds);
      await this.requireEmailFree(tx, input.email);
      const created = await tx.user.create({
        data: {
          merchantId: scope.merchantId,
          name: input.name,
          email: input.email,
          phoneCountry: phone.country,
          phoneNumber: phone.e164,
          passwordHash,
          // Signs in with the password the Company Admin set.
          status: 'ACTIVE',
          role: this.platformRoleFor(product, role),
          productRoles: { create: [{ product, role }] },
          assignments: { create: brandIds.map((brandId) => ({ brandId })) },
        },
        select: USER_SELECT,
      });
      return this.present(created, product, brands);
    });
  }

  /** The same rules as adding, without the password. */
  async edit(
    scope: RequestScope,
    userId: string,
    input: ProductUserEditInput,
  ): Promise<ProductUser> {
    const product = this.authorise(scope);
    const role = this.requireAssignableRole(product, input.role);
    const phone = this.requireValidPhone(input.phone);
    return this.prisma.withScope(scope, async (tx) => {
      const existing = await this.requireTeamMember(tx, scope, userId);
      const brands = await this.companyBrands(tx, scope);
      const brandIds = this.requireCompanyBrands(brands, input.brandIds);
      if (input.email !== existing.email.toLowerCase()) {
        await this.requireEmailFree(tx, input.email, existing.id);
      }
      await tx.userBrandAssignment.deleteMany({ where: { userId: existing.id } });
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          email: input.email,
          phoneCountry: phone.country,
          phoneNumber: phone.e164,
          // Sugrpay's role is also the platform role; other products leave it.
          ...(product === 'INVOICING' ? { role: role as Role } : {}),
          productRoles: {
            upsert: {
              where: { userId_product: { userId: existing.id, product } },
              create: { product, role },
              update: { role },
            },
          },
          assignments: { create: brandIds.map((brandId) => ({ brandId })) },
        },
        select: USER_SELECT,
      });
      return this.present(updated, product, brands);
    });
  }

  /** A deactivated user cannot sign in, and their sessions end now. Their
   * records are kept. The Company Admin cannot deactivate their own account. */
  async deactivate(scope: RequestScope, userId: string): Promise<ProductUser> {
    const product = this.authorise(scope);
    if (userId === scope.userId) {
      throw new ForbiddenException({
        message: 'you cannot deactivate your own account',
        code: 'CANNOT_DEACTIVATE_SELF',
      });
    }
    const user = await this.prisma.withScope(scope, async (tx) => {
      const existing = await this.requireTeamMember(tx, scope, userId);
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: { status: 'SUSPENDED', failedLogins: 0, lockedUntil: null },
        select: USER_SELECT,
      });
      return this.present(updated, product, await this.companyBrands(tx, scope));
    });
    await this.sessions.revokeAllForUser(userId);
    return user;
  }

  /** Active again: they can sign in again. */
  async reactivate(scope: RequestScope, userId: string): Promise<ProductUser> {
    const product = this.authorise(scope);
    return this.prisma.withScope(scope, async (tx) => {
      const existing = await this.requireTeamMember(tx, scope, userId);
      const updated =
        existing.status === 'SUSPENDED'
          ? await tx.user.update({
              where: { id: existing.id },
              data: { status: 'ACTIVE' },
              select: USER_SELECT,
            })
          : existing;
      return this.present(updated, product, await this.companyBrands(tx, scope));
    });
  }

  // --- Rules ------------------------------------------------------------

  private authorise(scope: RequestScope): Product {
    const product = askingProduct(scope);
    requireCompanyAdmin(scope);
    return product;
  }

  private requireAssignableRole(product: Product, role: string): string {
    if (!assignableProductRoles(product).includes(role)) {
      throw fieldError(
        'bad',
        'ROLE_NOT_AVAILABLE',
        'role',
        'choose one of the roles for this product',
      );
    }
    return role;
  }

  private requireValidPhone(phone: { country: string; number: string }) {
    const parsed = parsePhoneNumberFromString(phone.number, phone.country as CountryCode);
    if (!parsed || !parsed.isValid() || parsed.country !== phone.country) {
      throw fieldError(
        'bad',
        'PHONE_INVALID',
        'phone',
        'enter a valid phone number for that country',
      );
    }
    return { country: phone.country, e164: parsed.number };
  }

  private requireCompanyBrands(brands: BrandRow[], brandIds: string[]): string[] {
    const unique = [...new Set(brandIds)];
    if (unique.some((id) => !brands.some((b) => b.id === id))) {
      throw fieldError('bad', 'BRAND_NOT_IN_COMPANY', 'brandIds', 'choose Brands of your Company');
    }
    return unique;
  }

  /**
   * Unique across the platform, as at sign-up. Takes the same lock Sign Up
   * takes on the address, so a sign-up and an add cannot both claim it; the
   * check itself reads every company, which the scoped connection cannot.
   */
  private async requireEmailFree(tx: ScopedClient, email: string, exceptUserId?: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'signup:' + email}))`;
    const taken = await this.prisma.withoutScope(
      'checking an email is not used by an account in any company',
      (client) =>
        client.user.findFirst({
          where: {
            email: { equals: email, mode: 'insensitive' },
            ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
          },
          select: { id: true },
        }),
    );
    if (taken) {
      throw fieldError(
        'conflict',
        'EMAIL_TAKEN',
        'email',
        'an account with this email already exists',
      );
    }
  }

  /** A user of this Company other than the Company Admin's own account,
   * which is not managed from here. Another Company's user is not found. */
  private async requireTeamMember(tx: ScopedClient, scope: RequestScope, userId: string) {
    const user = await tx.user.findFirst({
      where: { id: userId, merchantId: scope.merchantId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('user not found');
    if (user.role === 'MERCHANT_OWNER') {
      throw new ConflictException({
        message: "the Company Admin's account is not managed here",
        code: 'COMPANY_ADMIN_ACCOUNT',
      });
    }
    return user;
  }

  private companyBrands(tx: ScopedClient, scope: RequestScope): Promise<BrandRow[]> {
    return tx.brand.findMany({
      where: { merchantId: scope.merchantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, displayName: true, status: true },
    });
  }

  /** Sugrpay's role is the platform role too. A user added from another
   * product gets the platform's least role: it is only for signing in and
   * reading their own company; the product role carries the access. */
  private platformRoleFor(product: Product, role: string): Role {
    return product === 'INVOICING' ? (role as Role) : 'READ_ONLY';
  }

  private present(user: UserRow, product: Product, brands: BrandRow[]): ProductUser {
    const productRoles = Object.fromEntries(user.productRoles.map((r) => [r.product, r.role]));
    const isAdmin = user.role === 'MERCHANT_OWNER';
    const assigned = new Set(user.assignments.map((a) => a.brandId));
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: phoneOf(user.phoneCountry, user.phoneNumber),
      role: roleInProduct({ role: user.role, productRoles }, product),
      brands: brands
        .filter((b) => isAdmin || assigned.has(b.id))
        .map((b) => ({ id: b.id, displayName: b.displayName, archived: b.status === 'ARCHIVED' })),
      status: user.status === 'SUSPENDED' ? 'DEACTIVATED' : user.status,
    };
  }
}
