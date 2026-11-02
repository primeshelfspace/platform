import { Controller, Get } from '@nestjs/common';
import type { RequestScope } from '@platform/kernel';
import { CurrentScope, RequirePermission } from '@platform/server';
import { ProductRolesService, type ProductRole } from '../application/product-roles.service.js';

/** Role Management — Role List: the asking product's roles, from its JWT alone. */
@Controller('company/roles')
export class ProductRolesController {
  constructor(private readonly roles: ProductRolesService) {}

  @Get()
  @RequirePermission('USERS', 'READ', { brandFrom: 'none' })
  list(@CurrentScope() scope: RequestScope): ProductRole[] {
    return this.roles.list(scope);
  }
}
