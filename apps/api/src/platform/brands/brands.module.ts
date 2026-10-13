import { Module } from '@nestjs/common';
import { StorageModule } from '../../adapters/storage/storage.module.js';
import { BrandsController } from './brands.controller.js';
import { BrandsService } from './brands.service.js';

@Module({
  imports: [StorageModule],
  controllers: [BrandsController],
  providers: [BrandsService],
})
export class BrandsModule {}
