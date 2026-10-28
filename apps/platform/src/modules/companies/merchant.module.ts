import { Module } from '@nestjs/common';
import { MerchantController } from './interface/merchant.controller.js';
import { MerchantService } from './application/merchant.service.js';

@Module({
  controllers: [MerchantController],
  providers: [MerchantService],
})
export class MerchantModule {}
