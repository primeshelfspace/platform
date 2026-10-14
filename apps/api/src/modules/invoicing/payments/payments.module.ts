import { Module } from '@nestjs/common';
import { GatewayModule } from '../../../shared/adapters/gateway/gateway.module.js';
import { PaymentsController } from './interface/payments.controller.js';
import { PaymentsService } from './application/payments.service.js';

@Module({
  imports: [GatewayModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
