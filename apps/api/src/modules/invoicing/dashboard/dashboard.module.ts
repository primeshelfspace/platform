import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../platform/modules.js';
import { DashboardController } from './interface/dashboard.controller.js';
import { DashboardService } from './application/dashboard.service.js';

@Module({
  // IntegrationsModule for the connection status banner (platform-owned).
  imports: [IntegrationsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
