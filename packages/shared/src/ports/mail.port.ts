/**
 * MailPort (TDD-001 §10.2).
 *
 * Implemented by the provider adapter in staging and production, and by the
 * local capture mailer everywhere else. Local development never reaches a real
 * provider (TER-001 §3.2).
 */

export interface MailAttachment {
  readonly filename: string;
  readonly contentType: string;
  /** Either inline content or a storage key the adapter resolves to a stream. */
  readonly content?: Buffer;
  readonly storageKey?: string;
}

export interface SendMailInput {
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly replyTo?: string;
  /** Brand-scoped sender identity. Falls back to the platform default. */
  readonly from: { readonly name: string; readonly address: string };
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attachments?: readonly MailAttachment[];
  /**
   * Correlates delivery events back to the invoice. Sent as a provider
   * metadata field and echoed on webhooks.
   */
  readonly messageTag: {
    /** Absent for platform-level mail that predates any brand — a set-password
     * link is sent before the recipient's organisation has one. */
    readonly brandId?: string;
    readonly invoiceId?: string;
    readonly templateKey: string;
  };
  /** Suppresses a duplicate send if the same key was already accepted. */
  readonly idempotencyKey: string;
}

export interface SendMailResult {
  readonly providerMessageId: string;
  readonly acceptedAt: Date;
  readonly recipients: readonly string[];
}

export const MAIL_EVENT_TYPES = [
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'OPENED',
  'CLICKED',
  'DEFERRED',
  'UNKNOWN',
] as const;
export type MailEventType = (typeof MAIL_EVENT_TYPES)[number];

export interface MailDeliveryEvent {
  readonly providerMessageId: string;
  readonly type: MailEventType;
  readonly recipient: string;
  readonly occurredAt: Date;
  readonly detail?: string | null;
  readonly bounceKind?: 'HARD' | 'SOFT' | null;
  readonly raw: unknown;
}

export interface RenderPreviewInput {
  readonly html: string;
  readonly subject: string;
}

export interface MailPort {
  readonly providerName: string;

  send(input: SendMailInput): Promise<SendMailResult>;

  /** Sanitised HTML for the template preview pane. No network fetches. */
  renderPreview(input: RenderPreviewInput): Promise<{ readonly html: string }>;

  verifySignature(payload: string | Buffer, headers: Readonly<Record<string, string>>): boolean;

  parseDeliveryEvent(payload: string | Buffer): MailDeliveryEvent;
}

export const MAIL_PORT = Symbol('MailPort');
