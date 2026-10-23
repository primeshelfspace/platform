import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BrandsModule } from '../brands/brands.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { EventForwarder } from './event-forwarder.js';
import { InternalController } from './internal.controller.js';

/** The platform's API-to-API surface (see InternalController). */
@Module({
  imports: [AuditModule, BrandsModule, IntegrationsModule],
  controllers: [InternalController],
  providers: [EventForwarder],
})
export class InternalModule {}
