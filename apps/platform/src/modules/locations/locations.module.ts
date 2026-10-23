import { Module } from '@nestjs/common';
import { LocationsController } from './interface/locations.controller.js';
import { LocationsService } from './application/locations.service.js';

@Module({
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
