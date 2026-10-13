import { Module } from '@nestjs/common';
import { MailModule } from '../../adapters/mail/mail.module.js';
import { StorageModule } from '../../adapters/storage/storage.module.js';
import { BrandSettingsController } from './brand-settings.controller.js';
import { BrandSettingsService } from './brand-settings.service.js';

/** Invoicing's per-brand settings: numbering, payment methods, payment page,
 * email templates and the invoice PDF. Brand identity itself is the
 * platform's (BrandsModule). */
@Module({
  imports: [StorageModule, MailModule],
  controllers: [BrandSettingsController],
  providers: [BrandSettingsService],
  exports: [BrandSettingsService],
})
export class BrandSettingsModule {}
