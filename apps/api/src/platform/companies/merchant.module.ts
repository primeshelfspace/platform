import { Module } from '@nestjs/common';
import { StorageModule } from '../../adapters/storage/storage.module.js';
import { MerchantController } from './merchant.controller.js';
import { MerchantService } from './merchant.service.js';

@Module({
  imports: [StorageModule],
  controllers: [MerchantController],
  providers: [MerchantService],
})
export class MerchantModule {}
