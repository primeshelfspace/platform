import { Module } from '@nestjs/common';
import { AuditLogService } from './application/audit-log.service.js';

@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
