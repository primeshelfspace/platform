import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  customerListQuerySchema,
  customerSchema,
  idSchema,
  type CustomerInput,
  type CustomerListQuery,
  type Scope,
} from '@fenwick/shared';
import type { Customer } from '@prisma/client';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, RequirePermission } from '../tenancy/authorisation.js';
import {
  CustomersService,
  type CustomerListResult,
  type CustomerWithContacts,
} from './customers.service.js';

/**
 * FR-CUS. Nested under the brand so the guard's default brandFrom: 'params'
 * check (TDD-001 §7.2) applies with no extra decoration — a Sales User
 * without this brand in their assignment never reaches the handler.
 */
@Controller('brands/:brandId/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('CUSTOMERS', 'READ')
  list(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Query(zodPipe(customerListQuerySchema)) query: CustomerListQuery,
  ): Promise<CustomerListResult> {
    return this.customers.list(scope, brandId, query);
  }

  @Get(':id')
  @RequirePermission('CUSTOMERS', 'READ')
  findOne(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
  ): Promise<CustomerWithContacts> {
    return this.customers.findOne(scope, brandId, id);
  }

  @Post()
  @RequirePermission('CUSTOMERS', 'WRITE')
  create(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Body(zodPipe(customerSchema)) body: CustomerInput,
  ): Promise<Customer> {
    return this.customers.create(scope, brandId, body);
  }

  @Patch(':id')
  @RequirePermission('CUSTOMERS', 'WRITE')
  update(
    @CurrentScope() scope: Scope,
    @Param('brandId', zodPipe(idSchema)) brandId: string,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(customerSchema)) body: CustomerInput,
  ): Promise<Customer> {
    return this.customers.update(scope, brandId, id, body);
  }
}
