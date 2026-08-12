-- Brand Settings > Branding > Email Receipt: the subject/body template and
-- layout for the invoice receipt email a customer gets. {{brand_name}},
-- {{customer_name}}, {{invoice_number}}, {{amount_due}} and {{due_date}} are
-- substituted at send time.
CREATE TYPE "EmailReceiptLayout" AS ENUM ('CLASSIC', 'HERO', 'MINIMAL');

ALTER TABLE "brand_settings" ADD COLUMN "email_receipt_layout" "EmailReceiptLayout" NOT NULL DEFAULT 'CLASSIC';
ALTER TABLE "brand_settings" ADD COLUMN "email_receipt_subject" TEXT NOT NULL DEFAULT 'New invoice from {{brand_name}}';
ALTER TABLE "brand_settings" ADD COLUMN "email_receipt_body" TEXT NOT NULL DEFAULT 'Hi {{customer_name}},

This is an automated message from {{brand_name}} regarding invoice {{invoice_number}}.

Amount due: {{amount_due}}
Due date: {{due_date}}

Please click the button below to view and pay your invoice.

Thank you for your business.';
