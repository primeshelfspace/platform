-- One row per mail-provider event for an invoice email: the send itself
-- ("SENT", written at send time with the provider's message id) and every
-- delivery-status callback that follows (DELIVERED, BOUNCED, COMPLAINED, ...).
-- The "SENT" row is what an inbound webhook resolves providerMessageId back
-- to an invoice through, since the provider's callback carries no tenant
-- information of its own.

CREATE TABLE "mail_delivery_event" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "bounce_kind" TEXT,
    "detail" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "mail_delivery_event_pkey" PRIMARY KEY ("id")
);

-- The idempotency guard for webhook redelivery: the same provider event
-- arriving twice (same message, same event type) is a no-op the second time,
-- not a second row — mirrors payment.idempotency_key's role for the
-- payment-gateway webhook.
CREATE UNIQUE INDEX "mail_delivery_event_provider_message_id_event_type_key"
    ON "mail_delivery_event"("provider_message_id", "event_type");

CREATE INDEX "mail_delivery_event_invoice_id_occurred_at_idx"
    ON "mail_delivery_event"("invoice_id", "occurred_at");

ALTER TABLE "mail_delivery_event" ADD CONSTRAINT "mail_delivery_event_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same isolation as invoice_event: visible wherever its invoice is.
ALTER TABLE mail_delivery_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY mail_delivery_event_scope ON mail_delivery_event
  USING (app_invoice_visible(invoice_id))
  WITH CHECK (app_invoice_visible(invoice_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON mail_delivery_event TO invoicing_app;
