import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from './interface/users.controller.js';
import { UsersService } from './application/users.service.js';

/** AuthModule is imported for PasswordResetService/AuthMailService — invite()
 * reuses the exact set-password-link plumbing AuthService.register() uses. */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
