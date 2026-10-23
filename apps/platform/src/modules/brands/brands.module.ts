import { Module } from '@nestjs/common';
import { StorageModule } from '@platform/server';
import { BrandsController } from './interface/brands.controller.js';
import { BrandsService } from './application/brands.service.js';

@Module({
  imports: [StorageModule],
  controllers: [BrandsController],
  providers: [BrandsService],
  // Products change brand fields they edit on their own screens (the
  // invoicing Branding tab's colour) through BrandsService, never directly.
  exports: [BrandsService],
})
export class BrandsModule {}
