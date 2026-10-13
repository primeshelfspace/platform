import { Module } from '@nestjs/common';
import { MailModule } from '../../adapters/mail/mail.module.js';
import { StorageModule } from '../../adapters/storage/storage.module.js';
import { AuditModule, BrandsModule } from '../../platform/modules.js';
import { BrandSettingsController } from './brand-settings.controller.js';
import { BrandSettingsService } from './brand-settings.service.js';

/** Invoicing's per-brand settings: numbering, payment methods, payment page,
 * email templates and the invoice PDF. Brand identity itself is the
 * platform's (BrandsModule) — the brand colour edited on these screens is
 * saved through it, and changes are recorded in the platform's audit log. */
@Module({
  imports: [StorageModule, MailModule, BrandsModule, AuditModule],
  controllers: [BrandSettingsController],
  providers: [BrandSettingsService],
  exports: [BrandSettingsService],
})
export class BrandSettingsModule {}
