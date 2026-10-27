-- One row per recipient per mail event for an invoice email: the send itself
-- ("SENT" for each recipient the mail server accepted, "REJECTED" for each it
-- refused) and every delivery-status callback that follows (DELIVERED,
-- BOUNCED, COMPLAINED, ...). The "SENT" rows are what an inbound webhook
-- resolves provider_message_id back to an invoice through, since the
-- provider's callback carries no tenant information of its own.
--
-- No copy of the provider's raw payload is kept: it carries personal data
-- (addresses) and nothing here needs it beyond the typed columns.

CREATE TYPE "MailDeliveryEventType" AS ENUM (
    'SENT', 'REJECTED', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'OPENED', 'CLICKED', 'DEFERRED'
);
CREATE TYPE "MailBounceKind" AS ENUM ('HARD', 'SOFT');

CREATE TABLE "mail_delivery_event" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "event_type" "MailDeliveryEventType" NOT NULL,
    "recipient" TEXT NOT NULL,
    "bounce_kind" "MailBounceKind",
    "detail" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_delivery_event_pkey" PRIMARY KEY ("id")
);

-- The idempotency guard for webhook redelivery: the same provider event for
-- the same recipient arriving twice is a no-op the second time, not a second
-- row (one message to To and CC yields one row per recipient).
CREATE UNIQUE INDEX "mail_delivery_event_provider_message_id_event_type_recipient_key"
    ON "mail_delivery_event"("provider_message_id", "event_type", "recipient");

CREATE INDEX "mail_delivery_event_invoice_id_occurred_at_idx"
    ON "mail_delivery_event"("invoice_id", "occurred_at");

ALTER TABLE "mail_delivery_event" ADD CONSTRAINT "mail_delivery_event_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_delivery_event" ADD CONSTRAINT "mail_delivery_event_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same isolation as invoice_event: visible wherever its invoice is.
ALTER TABLE mail_delivery_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY mail_delivery_event_scope ON mail_delivery_event
  USING (app_invoice_visible(invoice_id))
  WITH CHECK (app_invoice_visible(invoice_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON mail_delivery_event TO invoicing_app;
