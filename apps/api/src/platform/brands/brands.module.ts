import { Module } from '@nestjs/common';
import { StorageModule } from '../../adapters/storage/storage.module.js';
import { BrandsController } from './brands.controller.js';
import { BrandsService } from './brands.service.js';

@Module({
  imports: [StorageModule],
  controllers: [BrandsController],
  providers: [BrandsService],
  // Products change brand fields they edit on their own screens (the
  // invoicing Branding tab's colour) through BrandsService, never directly.
  exports: [BrandsService],
})
export class BrandsModule {}
