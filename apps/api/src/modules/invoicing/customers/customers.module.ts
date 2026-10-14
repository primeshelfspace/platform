import { Module } from '@nestjs/common';
import { CustomersController } from './interface/customers.controller.js';
import { CustomersService } from './application/customers.service.js';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
