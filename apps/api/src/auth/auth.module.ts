import { Module } from '@nestjs/common';
import { MailModule } from '../adapters/mail/mail.module.js';
import { AuthController } from './auth.controller.js';
import { AuthMailService } from './auth-mail.service.js';
import { AuthService } from './auth.service.js';
import { PasswordResetService } from './password-reset.service.js';

/**
 * SessionService is not provided here — TenancyModule is @Global and already
 * exports it, so the guard and this module share one instance rather than two
 * with divergent views of the same table.
 *
 * MailModule is imported for the set-password link: signup is not complete
 * until that message is accepted, so this module genuinely depends on a mailer
 * rather than merely enqueuing to one.
 */
@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordResetService, AuthMailService],
  exports: [AuthService, PasswordResetService],
})
export class AuthModule {}
