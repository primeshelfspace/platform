import { Module } from '@nestjs/common';
import { StorageModule } from '../adapters/storage/storage.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { ChecksController } from './checks.controller.js';
import { ChecksService } from './checks.service.js';

@Module({
  imports: [StorageModule, InvoicesModule],
  controllers: [ChecksController],
  providers: [ChecksService],
})
export class ChecksModule {}
