import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { idSchema, type RequestScope } from '@platform/kernel';
import {
  createLocationSchema,
  updateLocationSchema,
  type CreateLocationInput,
  type UpdateLocationInput,
} from '@platform/platform-contracts';
import { zodPipe } from '@platform/server';
import { CurrentScope, RequirePermission } from '@platform/server';
import { LocationsService, type Location } from '../application/locations.service.js';

/**
 * Stores and warehouses. Company-wide routes (brandFrom 'none'): which
 * locations a caller sees is decided by row-level security — see
 * LocationsService.
 */
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermission('LOCATIONS', 'READ', { brandFrom: 'none' })
  list(@CurrentScope() scope: RequestScope): Promise<Location[]> {
    return this.locations.list(scope);
  }

  @Get(':id')
  @RequirePermission('LOCATIONS', 'READ', { brandFrom: 'none' })
  findOne(
    @CurrentScope() scope: RequestScope,
    @Param('id', zodPipe(idSchema)) id: string,
  ): Promise<Location> {
    return this.locations.findOne(scope, id);
  }

  @Post()
  @RequirePermission('LOCATIONS', 'WRITE', { brandFrom: 'none' })
  create(
    @CurrentScope() scope: RequestScope,
    @Body(zodPipe(createLocationSchema)) body: CreateLocationInput,
  ): Promise<Location> {
    return this.locations.create(scope, body);
  }

  @Patch(':id')
  @RequirePermission('LOCATIONS', 'WRITE', { brandFrom: 'none' })
  update(
    @CurrentScope() scope: RequestScope,
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateLocationSchema)) body: UpdateLocationInput,
  ): Promise<Location> {
    return this.locations.update(scope, id, body);
  }
}
