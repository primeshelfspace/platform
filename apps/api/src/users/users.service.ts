import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import {
  coversAllBrands,
  mayAssignRole,
  type InviteUserInput,
  type RequestScope,
  type Role,
  type UserListQuery,
  type UserStatus,
} from '@fenwick/shared';
import { PrismaService, type ScopedClient } from '../infra/prisma/prisma.service.js';
import { hashPassword } from '../auth/password.js';
import { PasswordResetService } from '../auth/password-reset.service.js';
import { AuthMailService } from '../auth/auth-mail.service.js';

export interface ManagedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly status: string;
  readonly assignedBrandIds: string[];
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
}

export interface ManagedUserListResult {
  readonly data: ManagedUser[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

type UserWithAssignments = User & { assignments: { brandId: string }[] };

/**
 * FR-USR. Permissions themselves are never stored here — the matrix in
 * domain/roles.ts is the only source of what a role may do. What this service
 * owns is the part the matrix cannot express (see the footnote on the USERS
 * row in roles.ts): which role and which brands a given user actually holds,
 * and the seniority/brand-scoping rules around changing either.
 *
 * Every method runs inside PrismaService.withScope — the `user` RLS policy
 * already confines every query to the caller's merchant; a Brand Admin's
 * narrower view (their own brands only) is enforced here on top of that,
 * since RLS has no concept of "which brands this particular Brand Admin
 * administers."
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordResets: PasswordResetService,
    private readonly mail: AuthMailService,
  ) {}

  async list(scope: RequestScope, query: UserListQuery): Promise<ManagedUserListResult> {
    return this.prisma.withScope(scope, async (tx) => {
      const where = this.listWhere(scope, query);

      const [rows, total] = await Promise.all([
        tx.user.findMany({
          where,
          include: { assignments: true },
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
          },
          include: { assignments: true },
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
          },
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
          include: { assignments: true },
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
        include: { assignments: true },
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
        include: { assignments: true },
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
      include: { assignments: true },
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
    if (PrismaService.isUniqueViolation(error)) {
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
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
