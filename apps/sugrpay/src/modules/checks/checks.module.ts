import { Module } from '@nestjs/common';
import { StorageModule } from '@platform/server';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { ChecksController } from './interface/checks.controller.js';
import { ChecksService } from './application/checks.service.js';

@Module({
  imports: [StorageModule, InvoicesModule],
  controllers: [ChecksController],
  providers: [ChecksService],
})
export class ChecksModule {}
