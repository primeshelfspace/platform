import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { idSchema, type RequestScope } from '@platform/kernel';
import {
  productUserEditSchema,
  productUserListQuerySchema,
  productUserSchema,
  type ProductUserEditInput,
  type ProductUserInput,
  type ProductUserListQuery,
} from '@platform/platform-contracts';
import { CurrentScope, RequirePermission, zodPipe } from '@platform/server';
import { ProductUsersService, type ProductUser } from '../application/product-users.service.js';

/**
 * User Management (add, edit, deactivate, reactivate) and User List, from a
 * product with its JWT. USERS lets the guard through for user-managing roles;
 * ProductUsersService then allows the Company Admin only.
 */
@Controller('company/users')
export class ProductUsersController {
  constructor(private readonly users: ProductUsersService) {}

  @Get()
  @RequirePermission('USERS', 'READ', { brandFrom: 'none' })
  list(
    @CurrentScope() scope: RequestScope,
    @Query(zodPipe(productUserListQuerySchema)) query: ProductUserListQuery,
  ): Promise<ProductUser[]> {
    return this.users.list(scope, query);
  }

  @Post()
  @RequirePermission('USERS', 'WRITE', { brandFrom: 'none' })
  add(
    @CurrentScope() scope: RequestScope,
    @Body(zodPipe(productUserSchema)) body: ProductUserInput,
  ): Promise<ProductUser> {
    return this.users.add(scope, body);
  }

  @Put(':userId')
  @RequirePermission('USERS', 'WRITE', { brandFrom: 'none' })
  edit(
    @CurrentScope() scope: RequestScope,
    @Param('userId', zodPipe(idSchema)) userId: string,
    @Body(zodPipe(productUserEditSchema)) body: ProductUserEditInput,
  ): Promise<ProductUser> {
    return this.users.edit(scope, userId, body);
  }

  @Post(':userId/deactivate')
  @RequirePermission('USERS', 'WRITE', { brandFrom: 'none' })
  @HttpCode(200)
  deactivate(
    @CurrentScope() scope: RequestScope,
    @Param('userId', zodPipe(idSchema)) userId: string,
  ): Promise<ProductUser> {
    return this.users.deactivate(scope, userId);
  }

  @Post(':userId/reactivate')
  @RequirePermission('USERS', 'WRITE', { brandFrom: 'none' })
  @HttpCode(200)
  reactivate(
    @CurrentScope() scope: RequestScope,
    @Param('userId', zodPipe(idSchema)) userId: string,
  ): Promise<ProductUser> {
    return this.users.reactivate(scope, userId);
  }
}
