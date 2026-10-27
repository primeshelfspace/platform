import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  IntegrationError,
  MAIL_EVENT_TYPES,
  type MailEventType,
  type MailDeliveryEvent,
  type MailPort,
  type RenderPreviewInput,
  type SendMailInput,
  type SendMailResult,
} from '@platform/kernel';
import { ENV, type Env } from '../../config/env.js';

/** nodemailer's `accepted`/`rejected` arrays mix plain address strings with
 * `{name, address}` objects depending on how the recipient was specified. */
function addressText(entry: string | { address?: string; name?: string }): string {
  return typeof entry === 'string' ? entry : (entry.address ?? entry.name ?? String(entry));
}

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
          // An attachment with a cid is part of the body, not a download —
          // without the inline disposition a client may list the brand logo
          // as a paperclip alongside showing it.
          ...(a.cid ? { cid: a.cid, contentDisposition: 'inline' as const } : {}),
        })),
        headers: {
          'X-Sugrpay-Template': input.messageTag.templateKey,
          // Both omitted rather than sent empty when absent: platform-level
          // mail (a set-password link) predates any brand or invoice.
          ...(input.messageTag.brandId ? { 'X-Sugrpay-Brand': input.messageTag.brandId } : {}),
          ...(input.messageTag.invoiceId
            ? { 'X-Sugrpay-Invoice': input.messageTag.invoiceId }
            : {}),
        },
      });

      // sendMail resolving is not the same as every recipient being accepted:
      // a relay can take the DATA command and still 5xx one RCPT TO without
      // failing the whole transaction — nodemailer reports that split as
      // `accepted`/`rejected` rather than throwing.
      //
      // Nobody accepted: nothing was sent, so this is a failed send, the same
      // as a connection refusal. Some accepted: the email WAS sent to them —
      // reporting a failure would make staff send it again and those
      // recipients get it twice — so it is a send, with the refused addresses
      // reported back for the caller to record (InvoicesService puts them on
      // the invoice timeline).
      if (info.accepted.length === 0 && info.rejected.length > 0) {
        const rejected = info.rejected.map(addressText).join(', ');
        const accepted = info.accepted.map(addressText).join(', ') || '(none)';
        throw new IntegrationError({
          message: `SMTP relay rejected every recipient: ${rejected}`,
          // A rejection returned alongside an otherwise-successful transaction
          // is almost always the relay's own 5xx on that address (unknown
          // mailbox, policy) rather than a transient condition — a transient
          // one usually fails the whole transaction instead of splitting it.
          errorClass: 'VALIDATION',
          provider: this.providerName,
          providerMessage: `accepted: ${accepted}; rejected: ${rejected}; relay response: ${info.response}`,
        });
      }

      this.seen.add(input.idempotencyKey);
      return {
        providerMessageId: info.messageId ?? randomUUID(),
        acceptedAt: new Date(),
        // Only the recipients the relay actually took; the refused ones apart.
        recipients: info.accepted.map(addressText),
        rejected: info.rejected.map(addressText),
      };
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
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
    // Its own secret, never SESSION_SECRET (which signs sessions and OAuth
    // state): this one is shared with whatever posts delivery events. Unset
    // means the webhook accepts nothing.
    const secret = this.env.MAIL_WEBHOOK_SECRET;
    const provided = headers['x-sugrpay-signature'];
    if (!secret || !provided) return false;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseDeliveryEvent(payload: string | Buffer): MailDeliveryEvent {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(payload.toString()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const text = (value: unknown, max: number): string =>
      typeof value === 'string' ? value.slice(0, max) : '';
    const type = MAIL_EVENT_TYPES.includes(body['type'] as MailEventType)
      ? (body['type'] as MailEventType)
      : 'UNKNOWN';
    const occurredAt = new Date(text(body['occurredAt'], 40));
    return {
      providerMessageId: text(body['messageId'], 300),
      type,
      recipient: text(body['recipient'], 320).toLowerCase(),
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      detail: text(body['detail'], 500) || null,
      bounceKind:
        body['bounceKind'] === 'HARD' || body['bounceKind'] === 'SOFT' ? body['bounceKind'] : null,
      raw: null,
    };
  }

  async verifyConnection(): Promise<boolean> {
    await this.transporter.verify();
    return true;
  }
}
