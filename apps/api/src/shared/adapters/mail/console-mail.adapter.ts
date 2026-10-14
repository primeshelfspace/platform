import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  MailDeliveryEvent,
  MailPort,
  RenderPreviewInput,
  SendMailInput,
  SendMailResult,
} from '@sugrpay/shared';

/**
 * ConsoleMailAdapter — logs instead of sending. Used in CI and in unit tests,
 * where even the local sink is more infrastructure than the test needs.
 *
 * `outbox` keeps everything sent, so a test can assert on mail without any
 * network involvement at all.
 */
@Injectable()
export class ConsoleMailAdapter implements MailPort {
  readonly providerName = 'console';

  private readonly logger = new Logger(ConsoleMailAdapter.name);
  readonly outbox: SendMailInput[] = [];

  async send(input: SendMailInput): Promise<SendMailResult> {
    this.outbox.push(input);
    this.logger.log(`mail → ${input.to.join(', ')} :: ${input.subject}`);
    return {
      providerMessageId: `console-${randomUUID()}`,
      acceptedAt: new Date(),
      recipients: [...input.to],
    };
  }

  async renderPreview(input: RenderPreviewInput): Promise<{ html: string }> {
    return { html: input.html };
  }

  verifySignature(): boolean {
    return false;
  }

  parseDeliveryEvent(payload: string | Buffer): MailDeliveryEvent {
    const body = JSON.parse(payload.toString()) as Record<string, unknown>;
    return {
      providerMessageId: String(body['messageId'] ?? ''),
      type: 'UNKNOWN',
      recipient: String(body['recipient'] ?? ''),
      occurredAt: new Date(),
      raw: body,
    };
  }

  clear(): void {
    this.outbox.length = 0;
  }
}
