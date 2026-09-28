import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  assignUserBrandsSchema,
  idSchema,
  inviteUserSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
  userListQuerySchema,
  type AssignUserBrandsInput,
  type InviteUserInput,
  type RequestScope,
  type UpdateUserRoleInput,
  type UpdateUserStatusInput,
  type UserListQuery,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import { UsersService, type ManagedUser, type ManagedUserListResult } from './users.service.js';

/**
 * FR-USR. USERS is merchant-wide in the matrix (the `user` RLS policy scopes
 * by merchant_id, not by brand), so every route opts out of the guard's
 * default params.brandId lookup with brandFrom: 'none'. A Brand Admin's
 * narrower, brand-scoped view is enforced inside UsersService instead — see
 * the footnote on the USERS row in packages/shared/src/domain/roles.ts.
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
    return this.users.updateRole(scope, id, body.role);
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
