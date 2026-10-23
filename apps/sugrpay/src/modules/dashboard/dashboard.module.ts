import { Module } from '@nestjs/common';
import { ZohoConnectionModule } from '../zoho-sync/application/zoho-connection.module.js';
import { DashboardController } from './interface/dashboard.controller.js';
import { DashboardService } from './application/dashboard.service.js';

@Module({
  // ZohoConnectionModule for the connection status banner (platform-owned).
  imports: [ZohoConnectionModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
