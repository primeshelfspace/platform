-- Brand Settings > Branding > Email Templates: adds the "Payment
-- Confirmation" and "Payment Failed" subject/body pairs alongside the
-- existing invoice receipt ones. All three share the brand's existing
-- email_receipt_layout and accent_color — only the content is per-template.
ALTER TABLE "brand_settings" ADD COLUMN "payment_confirmation_subject" TEXT NOT NULL DEFAULT 'Payment received for invoice {{invoice_number}}';
ALTER TABLE "brand_settings" ADD COLUMN "payment_confirmation_body" TEXT NOT NULL DEFAULT 'Hi {{customer_name}},

We''ve received your payment of {{amount_due}} for invoice {{invoice_number}} from {{brand_name}}.

Thank you for your business.';

ALTER TABLE "brand_settings" ADD COLUMN "payment_failed_subject" TEXT NOT NULL DEFAULT 'Payment failed for invoice {{invoice_number}}';
ALTER TABLE "brand_settings" ADD COLUMN "payment_failed_body" TEXT NOT NULL DEFAULT 'Hi {{customer_name}},

We were unable to process your payment of {{amount_due}} for invoice {{invoice_number}} from {{brand_name}}.

Please try again or contact us for help.';
