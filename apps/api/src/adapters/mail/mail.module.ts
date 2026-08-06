import { Module } from '@nestjs/common';
import { MAIL_PORT } from '@fenwick/shared';
import { ENV, type Env } from '../../config/env.js';
import { ConsoleMailAdapter } from './console-mail.adapter.js';
import { SmtpMailAdapter } from './smtp-mail.adapter.js';

/**
 * MAIL_DRIVER=postmark is not bound yet: the provider account is not
 * provisioned, and a half-written provider adapter is worse than none. The
 * environment schema now rejects `postmark` outright rather than merely
 * requiring a token for it — previously it satisfied the production guard
 * against `console` and then fell through to the console adapter anyway, which
 * meant a production deployment could boot looking correct while discarding
 * every message it sent.
 *
 * The SMTP adapter already reaches Postmark, SES, Resend and everything else
 * through their SMTP endpoints, so nothing is actually blocked by this.
 */
@Module({
  providers: [
    SmtpMailAdapter,
    ConsoleMailAdapter,
    {
      provide: MAIL_PORT,
      inject: [ENV, SmtpMailAdapter, ConsoleMailAdapter],
      useFactory: (env: Env, smtp: SmtpMailAdapter, console_: ConsoleMailAdapter) => {
        if (env.MAIL_DRIVER === 'smtp') return smtp;
        if (env.MAIL_DRIVER === 'console') return console_;
        // Unreachable: the environment schema rejects every other value. Thrown
        // rather than defaulted so that adding a driver to the enum without
        // binding an adapter fails loudly here instead of quietly posting every
        // message to the log.
        throw new Error(`MAIL_DRIVER=${env.MAIL_DRIVER} has no adapter bound`);
      },
    },
  ],
  exports: [MAIL_PORT, SmtpMailAdapter, ConsoleMailAdapter],
})
export class MailModule {}
