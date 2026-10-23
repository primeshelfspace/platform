import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { idSchema, type Product, type RequestScope } from '@platform/kernel';
import {
  assignUserBrandsSchema,
  assignUserLocationsSchema,
  productSchema,
  updateProductRoleSchema,
  type AssignUserLocationsInput,
  type UpdateProductRoleInput,
  inviteUserSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
  userListQuerySchema,
  type AssignUserBrandsInput,
  type InviteUserInput,
  type UpdateUserRoleInput,
  type UpdateUserStatusInput,
  type UserListQuery,
} from '@platform/platform-contracts';
import { zodPipe } from '@platform/server';
import { CurrentScope, RequirePermission } from '@platform/server';
import {
  UsersService,
  type ManagedUser,
  type ManagedUserListResult,
} from '../application/users.service.js';
import { RateLimit } from '@platform/server';

/**
 * FR-USR. USERS is merchant-wide in the matrix (the `user` RLS policy scopes
 * by merchant_id, not by brand), so every route opts out of the guard's
 * default params.brandId lookup with brandFrom: 'none'. A Brand Admin's
 * narrower, brand-scoped view is enforced inside UsersService instead — see
 * the footnote on the USERS row in packages/kernel/src/domain/roles.ts.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('USERS', 'READ', { brandFrom: 'none' })
  list(
    @CurrentScope() scope: RequestScope,
    @Query(zodPipe(userListQuerySchema)) query: UserListQuery,
  ): Promise<ManagedUserListResult> {
    return this.users.list(scope, query);
  }

  @Get(':id')
  @RequirePermission('USERS', 'READ', { brandFrom: 'none' })
  findOne(
    @CurrentScope() scope: RequestScope,
    @Param('id', zodPipe(idSchema)) id: string,
  ): Promise<ManagedUser> {
    return this.users.findOne(scope, id);
  }

  @Post('invite')
  @RateLimit({ name: 'user-invite', windowSeconds: 86400, perCompanyLimit: 100 })
  @RequirePermission('USERS', 'WRITE', { brandFrom: 'none' })
  invite(
    @CurrentScope() scope: RequestScope,
    @Body(zodPipe(inviteUserSchema)) body: InviteUserInput,
  ): Promise<ManagedUser> {
    return this.users.invite(scope, body);
  }

  @Patch(':id/role')
  @RequirePermission('USERS', 'WRITE', { brandFrom: 'none' })
  updateRole(
    @CurrentScope() scope: RequestScope,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateUserRoleSchema)) body: UpdateUserRoleInput,
  ): Promise<ManagedUser> {
    return this.users.updateRole(scope, id, body.role, body.brandIds);
  }

  @Put(':id/brands')
  @RequirePermission('USERS', 'WRITE', { brandFrom: 'none' })
  updateBrands(
    @CurrentScope() scope: RequestScope,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(assignUserBrandsSchema)) body: AssignUserBrandsInput,
  ): Promise<ManagedUser> {
    return this.users.updateBrands(scope, id, body.brandIds);
  }

  /** A role in one product, or `{ role: null }` to remove the product. */
  @Put(':id/product-roles/:product')
  @RequirePermission('USERS', 'WRITE', { brandFrom: 'none' })
  updateProductRole(
    @CurrentScope() scope: RequestScope,
    @Param('id', zodPipe(idSchema)) id: string,
    @Param('product', zodPipe(productSchema)) product: Product,
    @Body(zodPipe(updateProductRoleSchema)) body: UpdateProductRoleInput,
  ): Promise<ManagedUser> {
    return this.users.updateProductRole(scope, id, product, body.role);
  }

  @Put(':id/locations')
  @RequirePermission('USERS', 'WRITE', { brandFrom: 'none' })
  updateLocations(
    @CurrentScope() scope: RequestScope,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(assignUserLocationsSchema)) body: AssignUserLocationsInput,
  ): Promise<ManagedUser> {
    return this.users.updateLocations(scope, id, body.locationIds);
  }

  /** Matrix gives Brand Admin `RW` but not `D` on USERS, so suspending or
   * reactivating an account is Owner/Admin only — the guard enforces that on
   * its own, nothing extra needed here. */
  @Patch(':id/status')
  @RequirePermission('USERS', 'DELETE', { brandFrom: 'none' })
  updateStatus(
    @CurrentScope() scope: RequestScope,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateUserStatusSchema)) body: UpdateUserStatusInput,
  ): Promise<ManagedUser> {
    return this.users.updateStatus(scope, id, body.status);
  }
}
