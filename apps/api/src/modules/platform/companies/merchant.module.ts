import { Module } from '@nestjs/common';
import { StorageModule } from '../../../shared/adapters/storage/storage.module.js';
import { MerchantController } from './interface/merchant.controller.js';
import { MerchantService } from './application/merchant.service.js';

@Module({
  imports: [StorageModule],
  controllers: [MerchantController],
  providers: [MerchantService],
})
export class MerchantModule {}
