import { Module } from '@nestjs/common';
import { ZohoSyncModule } from '../zoho-sync/zoho-sync.module.js';
import { CustomersController } from './interface/customers.controller.js';
import { CustomersService } from './application/customers.service.js';

@Module({
  // ZohoSyncModule only for ZohoPullService's on-demand contact detail
  // (findOne) — not a dependency on the rest of the sync pipeline.
  imports: [ZohoSyncModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
