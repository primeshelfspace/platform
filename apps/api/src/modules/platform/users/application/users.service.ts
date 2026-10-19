import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '../../database/client.js';
import { type Product, type RequestScope } from '@platform/kernel';
import {
  coversAllBrands,
  mayAssignRole,
  productRoleError,
  type InviteUserInput,
  type Role,
  type UserListQuery,
  type UserStatus,
} from '@platform/platform-contracts';
import {
  PlatformPrismaService,
  type ScopedClient,
} from '../../database/platform-prisma.service.js';
import { hashPassword } from '../../auth/infrastructure/password.js';
import { PasswordResetService } from '../../auth/application/password-reset.service.js';
import { AuthMailService } from '../../auth/application/auth-mail.service.js';

export interface ManagedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly status: string;
  readonly assignedBrandIds: string[];
  /** The user's role in each product they may use; a missing product means no access. */
  readonly productRoles: Partial<Record<Product, string>>;
  readonly assignedLocationIds: string[];
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
}

export interface ManagedUserListResult {
  readonly data: ManagedUser[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

const USER_INCLUDE = { assignments: true, productRoles: true, locations: true } as const;

type UserWithAssignments = User & {
  assignments: { brandId: string }[];
  productRoles: { product: Product; role: string }[];
  locations: { locationId: string }[];
};

/**
 * FR-USR. Permissions themselves are never stored here — the matrix in
 * domain/roles.ts is the only source of what a role may do. What this service
 * owns is the part the matrix cannot express (see the footnote on the USERS
 * row in roles.ts): which role and which brands a given user actually holds,
 * and the seniority/brand-scoping rules around changing either.
 *
 * Every method runs inside PlatformPrismaService.withScope — the `user` RLS policy
 * already confines every query to the caller's merchant; a Brand Admin's
 * narrower view (their own brands only) is enforced here on top of that,
 * since RLS has no concept of "which brands this particular Brand Admin
 * administers."
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly passwordResets: PasswordResetService,
    private readonly mail: AuthMailService,
  ) {}

  async list(scope: RequestScope, query: UserListQuery): Promise<ManagedUserListResult> {
    return this.prisma.withScope(scope, async (tx) => {
      const where = this.listWhere(scope, query);

      const [rows, total] = await Promise.all([
        tx.user.findMany({
          where,
          include: USER_INCLUDE,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.user.count({ where }),
      ]);

      return {
        data: rows.map(toManagedUser),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async findOne(scope: RequestScope, id: string): Promise<ManagedUser> {
    return this.prisma.withScope(scope, async (tx) =>
      toManagedUser(await this.requireVisible(tx, scope, id)),
    );
  }

  /**
   * FR-ONB's register() is the template: create the row INVITED with an
   * unusable random password, then the same set-password-link plumbing
   * (PasswordResetService + AuthMailService) signup already uses — no second
   * mail template, no temporary password ever transmitted.
   */
  async invite(scope: RequestScope, input: InviteUserInput): Promise<ManagedUser> {
    if (!mayAssignRole(scope.role, input.role)) {
      throw new ForbiddenException('you may not assign a role above your own');
    }

    const brandIds = coversAllBrands(input.role) ? [] : dedupe(input.brandIds);
    if (!coversAllBrands(input.role) && brandIds.length === 0) {
      throw new BadRequestException('this role needs at least one assigned brand');
    }
    if (
      !coversAllBrands(scope.role) &&
      brandIds.some((id) => !scope.assignedBrandIds.includes(id))
    ) {
      throw new ForbiddenException('you may only assign brands you administer');
    }

    // The platform role is always the invoicing role.
    const productRoles = Object.fromEntries(
      Object.entries({ ...input.productRoles, INVOICING: input.role }).filter(([, role]) => role),
    ) as Partial<Record<Product, string>>;
    for (const [product, role] of Object.entries(productRoles) as [Product, string][]) {
      this.assertMayGrantProductRole(scope, product, role);
    }

    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));

    const created = await this.prisma.withScope(scope, async (tx) => {
      try {
        return await tx.user.create({
          data: {
            merchantId: scope.merchantId,
            email: input.email,
            name: input.name,
            passwordHash,
            role: input.role,
            status: 'INVITED',
            assignments: brandIds.length
              ? { create: brandIds.map((brandId) => ({ brandId })) }
              : undefined,
            productRoles: {
              create: (Object.entries(productRoles) as [Product, string][]).map(
                ([product, role]) => ({ product, role }),
              ),
            },
          },
          include: USER_INCLUDE,
        });
      } catch (error) {
        throw this.translateWriteError(error);
      }
    });

    const { token } = await this.passwordResets.issue(created.id);
    await this.mail.sendSetPasswordLink({
      to: created.email,
      name: created.name,
      token,
      isNewAccount: true,
    });

    return toManagedUser(created);
  }

  /**
   * Changes a user's role, and — when given — their brands in the same
   * transaction. Brands are mandatory when the move is from an all-brand
   * role to a brand-scoped one: the user holds no assignment rows yet, and
   * a brand-scoped account with none can see nothing at all (the same rule
   * invite() applies to a brand-scoped invitee).
   */
  async updateRole(
    scope: RequestScope,
    id: string,
    role: Role,
    brandIds?: readonly string[],
  ): Promise<ManagedUser> {
    if (id === scope.userId) {
      throw new ForbiddenException('you cannot change your own role');
    }

    return this.prisma.withScope(scope, async (tx) => {
      const existing = await this.requireVisible(tx, scope, id);

      if (!mayAssignRole(scope.role, role) || !mayAssignRole(scope.role, existing.role)) {
        throw new ForbiddenException('you may not assign a role above your own');
      }
      if (existing.role === 'MERCHANT_OWNER' && role !== 'MERCHANT_OWNER') {
        await this.assertNotLastOwner(tx, existing.id);
      }

      const becomesBrandScoped = coversAllBrands(existing.role) && !coversAllBrands(role);
      if (becomesBrandScoped && !brandIds?.length) {
        throw new BadRequestException('this role needs at least one assigned brand');
      }

      try {
        await tx.user.update({
          where: { id: existing.id },
          data: {
            role,
            // An all-brand role holds no assignment rows by convention
            // (readableBrandIds/coversAllBrands) — clear any left from a
            // previous, brand-scoped role so a later demotion doesn't
            // silently resurrect stale brand access.
            ...(coversAllBrands(role) ? { assignments: { deleteMany: {} } } : {}),
            ...(coversAllBrands(role) ? { locations: { deleteMany: {} } } : {}),
          },
        });
        // The platform role and the invoicing role move together, so the
        // existing users screen keeps working exactly as before.
        await tx.userProductRole.upsert({
          where: { userId_product: { userId: existing.id, product: 'INVOICING' } },
          create: { userId: existing.id, product: 'INVOICING', role },
          update: { role },
        });
        if (!coversAllBrands(role) && brandIds !== undefined) {
          await this.replaceAssignments(tx, scope, existing.id, dedupe(brandIds));
        }
      } catch (error) {
        throw this.translateWriteError(error);
      }

      return toManagedUser(
        await tx.user.findUniqueOrThrow({
          where: { id: existing.id },
          include: USER_INCLUDE,
        }),
      );
    });
  }

  /**
   * Replaces a user's brand assignments. A Brand Admin actor only ever
   * touches assignment rows for brands they themselves administer — a full
   * delete-and-recreate would otherwise let them silently revoke a brand
   * assignment made by a different Brand Admin for a brand they cannot even
   * see.
   *
   * The returned ManagedUser.assignedBrandIds is itself scoped the same way:
   * `user_brand_assignment`'s RLS policy filters every read inside this
   * transaction to app_brand_visible(), so a Brand Admin's response can only
   * ever list brands they administer — a brand this actor doesn't administer
   * may still be assigned underneath, just invisible to them, not removed.
   */
  async updateBrands(
    scope: RequestScope,
    id: string,
    brandIds: readonly string[],
  ): Promise<ManagedUser> {
    if (id === scope.userId) {
      throw new ForbiddenException('you cannot change your own brand assignments');
    }
    const deduped = dedupe(brandIds);

    return this.prisma.withScope(scope, async (tx) => {
      const existing = await this.requireVisible(tx, scope, id);

      if (!mayAssignRole(scope.role, existing.role)) {
        throw new ForbiddenException('insufficient permissions for this user');
      }
      if (coversAllBrands(existing.role)) {
        throw new ForbiddenException('this role already covers every brand');
      }

      await this.replaceAssignments(tx, scope, existing.id, deduped);

      const updated = await tx.user.findUniqueOrThrow({
        where: { id: existing.id },
        include: USER_INCLUDE,
      });
      return toManagedUser(updated);
    });
  }

  /**
   * The one place a brand-scoped user's assignments are rewritten — shared by
   * updateBrands and updateRole so the two can never apply different rules.
   *
   * An all-brand actor sees every assignment, so it replaces the whole set
   * and may not leave it empty (an account that can see nothing). A Brand
   * Admin only touches rows for brands they administer: a full replace would
   * silently revoke assignments made by another Brand Admin for brands this
   * one cannot see, which is also why emptying *their* slice is allowed —
   * the user may still hold brands outside it.
   */
  private async replaceAssignments(
    tx: ScopedClient,
    scope: RequestScope,
    userId: string,
    brandIds: readonly string[],
  ): Promise<void> {
    if (coversAllBrands(scope.role)) {
      if (brandIds.length === 0) {
        throw new BadRequestException('this role needs at least one assigned brand');
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          assignments: { deleteMany: {}, create: brandIds.map((brandId) => ({ brandId })) },
        },
      });
      return;
    }

    const administered = new Set(scope.assignedBrandIds);
    if (brandIds.some((brandId) => !administered.has(brandId))) {
      throw new ForbiddenException('you may only assign brands you administer');
    }
    await tx.userBrandAssignment.deleteMany({
      where: { userId, brandId: { in: [...administered] } },
    });
    if (brandIds.length) {
      await tx.userBrandAssignment.createMany({
        data: brandIds.map((brandId) => ({ userId, brandId })),
        skipDuplicates: true,
      });
    }
  }

  /**
   * Gives a user a role in one product, or takes the product away (`null`).
   * Invoicing roles follow the same seniority rule as the platform role (and
   * stay in step with it — the platform role is the invoicing role). Other
   * products' roles are granted by Owner/Merchant Admin only.
   */
  async updateProductRole(
    scope: RequestScope,
    id: string,
    product: Product,
    role: string | null,
  ): Promise<ManagedUser> {
    if (id === scope.userId) {
      throw new ForbiddenException('you cannot change your own product access');
    }
    if (role !== null) this.assertMayGrantProductRole(scope, product, role);
    if (product === 'INVOICING') {
      if (role === null) {
        throw new BadRequestException(
          'invoicing access follows the user’s role; suspend the user to remove it',
        );
      }
      // The invoicing role is the platform role: every rule of a role change applies.
      return this.updateRole(scope, id, role as Role);
    }

    return this.prisma.withScope(scope, async (tx) => {
      const existing = await this.requireVisible(tx, scope, id);
      if (!mayAssignRole(scope.role, existing.role)) {
        throw new ForbiddenException('insufficient permissions for this user');
      }

      if (role === null) {
        await tx.userProductRole.deleteMany({ where: { userId: existing.id, product } });
      } else {
        await tx.userProductRole.upsert({
          where: { userId_product: { userId: existing.id, product } },
          create: { userId: existing.id, product, role },
          update: { role },
        });
      }

      return toManagedUser(
        await tx.user.findUniqueOrThrow({ where: { id: existing.id }, include: USER_INCLUDE }),
      );
    });
  }

  /**
   * Replaces a user's location assignments. Row-level security confines both
   * the delete and the insert to locations the caller can see, so a Brand
   * Admin cannot touch assignments to another brand's stores.
   */
  async updateLocations(
    scope: RequestScope,
    id: string,
    locationIds: readonly string[],
  ): Promise<ManagedUser> {
    if (id === scope.userId) {
      throw new ForbiddenException('you cannot change your own location assignments');
    }
    const deduped = dedupe(locationIds);

    return this.prisma.withScope(scope, async (tx) => {
      const existing = await this.requireVisible(tx, scope, id);
      if (!mayAssignRole(scope.role, existing.role)) {
        throw new ForbiddenException('insufficient permissions for this user');
      }
      if (coversAllBrands(existing.role)) {
        throw new ForbiddenException('this role already covers every location');
      }

      const visible = await tx.location.count({ where: { id: { in: deduped } } });
      if (visible !== deduped.length) {
        throw new BadRequestException('location not found');
      }

      try {
        await tx.userLocationAssignment.deleteMany({ where: { userId: existing.id } });
        if (deduped.length) {
          await tx.userLocationAssignment.createMany({
            data: deduped.map((locationId) => ({ userId: existing.id, locationId })),
          });
        }
      } catch (error) {
        throw this.translateWriteError(error);
      }

      return toManagedUser(
        await tx.user.findUniqueOrThrow({ where: { id: existing.id }, include: USER_INCLUDE }),
      );
    });
  }

  private assertMayGrantProductRole(scope: RequestScope, product: Product, role: string): void {
    const invalid = productRoleError(product, role);
    if (invalid) throw new BadRequestException(invalid);
    if (product === 'INVOICING') {
      if (!mayAssignRole(scope.role, role as Role)) {
        throw new ForbiddenException('you may not assign a role above your own');
      }
      return;
    }
    if (!coversAllBrands(scope.role)) {
      throw new ForbiddenException('only an owner or admin may grant access to this product');
    }
  }

  async updateStatus(scope: RequestScope, id: string, status: UserStatus): Promise<ManagedUser> {
    if (id === scope.userId) {
      throw new ForbiddenException('you cannot change your own account status');
    }

    return this.prisma.withScope(scope, async (tx) => {
      const existing = await this.requireVisible(tx, scope, id);

      // Same rank rule as updateRole/updateBrands: suspending an account you
      // could not have assigned that role to in the first place is still a
      // rank violation, not just a role change.
      if (!mayAssignRole(scope.role, existing.role)) {
        throw new ForbiddenException('insufficient permissions for this user');
      }
      if (status === 'SUSPENDED' && existing.role === 'MERCHANT_OWNER') {
        await this.assertNotLastOwner(tx, existing.id);
      }

      const updated = await tx.user.update({
        where: { id: existing.id },
        data: {
          status,
          ...(status === 'SUSPENDED' ? { failedLogins: 0, lockedUntil: null } : {}),
        },
        include: USER_INCLUDE,
      });
      return toManagedUser(updated);
    });
  }

  /** Brand Admin's slice of the matrix's USERS row (roles.ts footnote): every
   * other role either sees the whole merchant or nothing at all (the guard
   * already keeps "nothing" callers off this service entirely). */
  private visibilityWhere(scope: RequestScope): Prisma.UserWhereInput[] {
    if (coversAllBrands(scope.role)) return [];
    return [
      {
        OR: [
          { id: scope.userId },
          { assignments: { some: { brandId: { in: [...scope.assignedBrandIds] } } } },
        ],
      },
    ];
  }

  private listWhere(scope: RequestScope, query: UserListQuery): Prisma.UserWhereInput {
    const clauses = this.visibilityWhere(scope);
    if (query.search) {
      const search = query.search;
      clauses.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (query.role) clauses.push({ role: query.role });
    if (query.status) clauses.push({ status: query.status });
    return clauses.length ? { AND: clauses } : {};
  }

  /** "Not found" covers both "does not exist" and "exists but outside this
   * Brand Admin's visibility" on purpose — see CustomersService for the same
   * NFR-SEC-025 reasoning applied to brand scoping. */
  private async requireVisible(
    tx: ScopedClient,
    scope: RequestScope,
    id: string,
  ): Promise<UserWithAssignments> {
    const clauses = this.visibilityWhere(scope);
    const row = await tx.user.findFirst({
      where: clauses.length ? { AND: [{ id }, ...clauses] } : { id },
      include: USER_INCLUDE,
    });
    if (!row) throw new NotFoundException('user not found');
    return row;
  }

  /** FR-AUTH continuity: the merchant must never be left with zero active
   * owners, whether by a role change or a suspension. */
  private async assertNotLastOwner(tx: ScopedClient, excludingUserId: string): Promise<void> {
    const remaining = await tx.user.count({
      where: { role: 'MERCHANT_OWNER', status: { not: 'SUSPENDED' }, id: { not: excludingUserId } },
    });
    if (remaining === 0) {
      throw new ConflictException('the merchant must always have at least one active owner');
    }
  }

  /** Same reasoning as CustomersService.translateWriteError: a bare RLS text
   * match is the only signal a WITH CHECK failure gives Prisma. */
  private translateWriteError(error: unknown): Error {
    if (PlatformPrismaService.isUniqueViolation(error)) {
      return new ConflictException('a user with this email address already exists');
    }
    if (error instanceof Error && /row-level security/i.test(error.message)) {
      return new ForbiddenException('insufficient permissions');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

function toManagedUser(row: UserWithAssignments): ManagedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    assignedBrandIds: row.assignments.map((a) => a.brandId),
    productRoles: Object.fromEntries(row.productRoles.map((r) => [r.product, r.role])),
    assignedLocationIds: row.locations.map((l) => l.locationId),
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
