import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  IntegrationError,
  type MailDeliveryEvent,
  type MailPort,
  type RenderPreviewInput,
  type SendMailInput,
  type SendMailResult,
} from '@fenwick/shared';
import { ENV, type Env } from '../../config/env.js';

/**
 * SMTP MailPort implementation.
 *
 * Locally this points at the mail sink (or Mailcatcher under Docker), so no
 * development path reaches a real provider or a real inbox. The same adapter
 * serves any SMTP relay in a deployed environment.
 */
@Injectable()
export class SmtpMailAdapter implements MailPort {
  readonly providerName = 'smtp';

  private readonly logger = new Logger(SmtpMailAdapter.name);
  private readonly transporter: Transporter;
  private readonly seen = new Set<string>();

  constructor(@Inject(ENV) private readonly env: Env) {
    // Implicit TLS on 465, STARTTLS on 587 and 25. Derived from the port when
    // SMTP_SECURE is unset, because getting this wrong fails as a connection
    // timeout rather than anything that names TLS.
    const secure = env.SMTP_SECURE ?? env.SMTP_PORT === 465;

    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure,
      // Keyed off whether credentials exist, NOT off APP_ENV. The in-repo sink
      // speaks plaintext and needs no auth, so skipping STARTTLS is right for
      // it — but pointing a local APP_ENV at a real provider is a normal thing
      // to do while testing, and Gmail and friends refuse plaintext on 587.
      // Tying this to APP_ENV made that combination fail with a bare
      // "SMTP send failed" while a plain nodemailer verify() succeeded.
      ignoreTLS: !secure && !env.SMTP_USER,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
    });
  }

  async send(input: SendMailInput): Promise<SendMailResult> {
    // Cheap in-process guard against an obvious double-send. The durable
    // guarantee is the queue's job id; this catches the same-process case.
    if (this.seen.has(input.idempotencyKey)) {
      this.logger.warn(`suppressed duplicate send for ${input.idempotencyKey}`);
      return {
        providerMessageId: `suppressed-${input.idempotencyKey}`,
        acceptedAt: new Date(),
        recipients: [...input.to],
      };
    }

    try {
      const info = await this.transporter.sendMail({
        from: { name: input.from.name, address: input.from.address },
        to: [...input.to],
        cc: input.cc ? [...input.cc] : undefined,
        bcc: input.bcc ? [...input.bcc] : undefined,
        replyTo: input.replyTo,
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          content: a.content,
        })),
        headers: {
          'X-Fenwick-Template': input.messageTag.templateKey,
          // Both omitted rather than sent empty when absent: platform-level
          // mail (a set-password link) predates any brand or invoice.
          ...(input.messageTag.brandId ? { 'X-Fenwick-Brand': input.messageTag.brandId } : {}),
          ...(input.messageTag.invoiceId
            ? { 'X-Fenwick-Invoice': input.messageTag.invoiceId }
            : {}),
        },
      });

      this.seen.add(input.idempotencyKey);
      return {
        providerMessageId: info.messageId ?? randomUUID(),
        acceptedAt: new Date(),
        recipients: [...input.to],
      };
    } catch (error) {
      throw new IntegrationError({
        message: 'SMTP send failed',
        // A relay refusal is almost always transient; a permanent rejection
        // arrives later as a bounce event, not as a send error.
        errorClass: 'TRANSIENT',
        provider: this.providerName,
        providerMessage: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    }
  }

  async renderPreview(input: RenderPreviewInput): Promise<{ html: string }> {
    // Previews never fetch anything: a template that loads a remote image would
    // otherwise leak the preview to a third party.
    const html = input.html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return { html };
  }

  verifySignature(payload: string | Buffer, headers: Readonly<Record<string, string>>): boolean {
    const provided = headers['x-fenwick-signature'];
    if (!provided) return false;
    const expected = createHmac('sha256', this.env.SESSION_SECRET).update(payload).digest('hex');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseDeliveryEvent(payload: string | Buffer): MailDeliveryEvent {
    const body = JSON.parse(payload.toString()) as Record<string, unknown>;
    return {
      providerMessageId: String(body['messageId'] ?? ''),
      type: (body['type'] as MailDeliveryEvent['type']) ?? 'UNKNOWN',
      recipient: String(body['recipient'] ?? ''),
      occurredAt: body['occurredAt'] ? new Date(String(body['occurredAt'])) : new Date(),
      detail: (body['detail'] as string | undefined) ?? null,
      bounceKind: (body['bounceKind'] as 'HARD' | 'SOFT' | undefined) ?? null,
      raw: body,
    };
  }

  async verifyConnection(): Promise<boolean> {
    await this.transporter.verify();
    return true;
  }
}
