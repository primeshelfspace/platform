import { Module } from '@nestjs/common';
import { AccountingModule } from '../../../adapters/accounting/accounting.module.js';
import { ZohoConnectionService } from './zoho-connection.service.js';

/** The brand's Zoho Books connection (Sugrpay's zoho_connection table). */
@Module({
  imports: [AccountingModule],
  providers: [ZohoConnectionService],
  exports: [ZohoConnectionService],
})
export class ZohoConnectionModule {}
