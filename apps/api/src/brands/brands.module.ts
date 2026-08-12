import { Module } from '@nestjs/common';
import { MailModule } from '../adapters/mail/mail.module.js';
import { StorageModule } from '../adapters/storage/storage.module.js';
import { BrandSettingsController } from './brand-settings.controller.js';
import { BrandSettingsService } from './brand-settings.service.js';
import { BrandsController } from './brands.controller.js';
import { BrandsService } from './brands.service.js';

@Module({
  imports: [StorageModule, MailModule],
  controllers: [BrandsController, BrandSettingsController],
  providers: [BrandsService, BrandSettingsService],
  exports: [BrandSettingsService],
})
export class BrandsModule {}
