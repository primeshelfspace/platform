import { Inject, Injectable, Logger } from '@nestjs/common';
import { MAIL_PORT, type MailPort } from '@fenwick/shared';
import { ENV, type Env } from '../config/env.js';

/**
 * The authentication emails: the set-password link a new owner receives at
 * signup, and the same link re-sent as a password reset.
 *
 * Platform-level rather than brand-level — it goes out before the recipient's
 * organisation has any brand at all, which is why `messageTag.brandId` is
 * optional on MailPort.
 *
 * Deliberately sent inline rather than through the `mail` queue: this message
 * IS the signup flow. If it cannot be sent, the person is left with an account
 * they can never reach, so the failure has to surface on the request that
 * caused it rather than in a worker log they will never read.
 */
@Injectable()
export class AuthMailService {
  private readonly logger = new Logger(AuthMailService.name);

  constructor(
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async sendSetPasswordLink(input: {
    readonly to: string;
    readonly name: string;
    readonly token: string;
    /** True for signup, false for a later "I forgot my password" — same link,
     * different words, because the two arrive in very different contexts. */
    readonly isNewAccount: boolean;
  }): Promise<void> {
    const url = `${this.env.ADMIN_PUBLIC_URL}/set-password?token=${encodeURIComponent(input.token)}`;
    const subject = input.isNewAccount
      ? 'Set your password to finish creating your account'
      : 'Reset your password';
    const lead = input.isNewAccount
      ? 'Your account has been created. Set a password to finish signing up.'
      : 'We received a request to reset your password.';

    await this.mail.send({
      to: [input.to],
      from: parseFrom(this.env.MAIL_FROM),
      subject,
      text: [
        `Hi ${input.name},`,
        '',
        lead,
        '',
        url,
        '',
        'This link can be used once and expires in 24 hours.',
        "If you weren't expecting this, you can ignore this email.",
      ].join('\n'),
      html: renderHtml({ name: input.name, lead, url }),
      messageTag: { templateKey: input.isNewAccount ? 'auth.set-password' : 'auth.reset-password' },
      // One send per token. A retry of the same request cannot produce a second
      // email, and a fresh token is a genuinely different message.
      idempotencyKey: `set-password:${input.token.slice(0, 16)}`,
    });

    this.logger.log(`set-password link sent to ${input.to}`);
  }
}

/** `"Fenwick Invoicing <billing@localhost>"` -> name and address. Falls back to
 * treating the whole value as an address, which is the other shape people
 * configure. */
function parseFrom(value: string): { name: string; address: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (match?.[1] && match[2]) return { name: match[1].trim(), address: match[2].trim() };
  return { name: 'Fenwick Invoicing', address: value.trim() };
}

function renderHtml(input: { name: string; lead: string; url: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#F8FAFC;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
    <table role="presentation" style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;">
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 12px;font-size:20px;">Set your password</h1>
        <p style="margin:0 0 8px;font-size:15px;">Hi ${escapeHtml(input.name)},</p>
        <p style="margin:0 0 24px;font-size:15px;color:#475569;">${escapeHtml(input.lead)}</p>
        <a href="${escapeHtml(input.url)}"
           style="display:inline-block;background:#0F172A;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;font-size:15px;font-weight:600;">
          Set your password
        </a>
        <p style="margin:24px 0 0;font-size:13px;color:#64748B;">
          This link can be used once and expires in 24 hours. If you weren&rsquo;t expecting this, you can ignore this email.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
