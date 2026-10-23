import { Module } from '@nestjs/common';
import { MailModule } from '@platform/server';
import { StorageModule } from '@platform/server';
import { BrandSettingsController } from './interface/brand-settings.controller.js';
import { BrandSettingsService } from './application/brand-settings.service.js';

/** Invoicing's per-brand settings: numbering, payment methods, payment page,
 * email templates and the invoice PDF. Brand identity itself is the
 * platform's (BrandsModule) — the brand colour edited on these screens is
 * saved through it, and changes are recorded in the platform's audit log. */
@Module({
  imports: [StorageModule, MailModule],
  controllers: [BrandSettingsController],
  providers: [BrandSettingsService],
  exports: [BrandSettingsService],
})
export class BrandSettingsModule {}
