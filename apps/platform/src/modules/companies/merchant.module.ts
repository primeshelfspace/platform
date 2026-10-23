import { Module } from '@nestjs/common';
import { StorageModule } from '@platform/server';
import { MerchantController } from './interface/merchant.controller.js';
import { MerchantService } from './application/merchant.service.js';

@Module({
  imports: [StorageModule],
  controllers: [MerchantController],
  providers: [MerchantService],
})
export class MerchantModule {}
