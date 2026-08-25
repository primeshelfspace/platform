import type { MailPort, MailDeliveryEvent, RenderPreviewInput, SendMailInput } from '@fenwick/shared';

/**
 * Zero-op stand-in for tests that need an InvoicesService instance but have
 * nothing to do with resendEmail — same reasoning as
 * infra/queue/fake-queue.service.ts's createFakeQueueService: a real
 * SmtpMailAdapter would actually dial out to whatever SMTP_HOST/PORT this
 * environment happens to have configured, which is not something an
 * unrelated fixture setup should ever risk doing.
 */
export function createFakeMailPort(): MailPort {
  return {
    providerName: 'fake',
    send: async (_input: SendMailInput) => ({
      providerMessageId: 'fake-message-id',
      acceptedAt: new Date(),
      recipients: [],
    }),
    renderPreview: async (input: RenderPreviewInput) => ({ html: input.html }),
    verifySignature: () => false,
    parseDeliveryEvent: (): MailDeliveryEvent => ({
      providerMessageId: 'fake',
      type: 'UNKNOWN',
      recipient: '',
      occurredAt: new Date(),
      detail: null,
      bounceKind: null,
      raw: {},
    }),
  };
}
