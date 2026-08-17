-- Brand Settings > Branding > Invoice PDF: layout and which optional
-- sections appear on the invoice PDF a customer receives/downloads.
CREATE TYPE "InvoicePdfLayout" AS ENUM ('CLASSIC', 'MODERN', 'MINIMAL');
CREATE TYPE "InvoicePdfPaymentTerms" AS ENUM ('DUE_ON_RECEIPT', 'NET_15', 'NET_30', 'NET_60');

ALTER TABLE "brand_settings" ADD COLUMN "invoice_pdf_layout" "InvoicePdfLayout" NOT NULL DEFAULT 'CLASSIC';
ALTER TABLE "brand_settings" ADD COLUMN "invoice_pdf_show_company_address" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "brand_settings" ADD COLUMN "invoice_pdf_show_payment_terms" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "brand_settings" ADD COLUMN "invoice_pdf_show_tax_breakdown" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "brand_settings" ADD COLUMN "invoice_pdf_show_notes" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "brand_settings" ADD COLUMN "invoice_pdf_company_name" TEXT;
ALTER TABLE "brand_settings" ADD COLUMN "invoice_pdf_company_address" TEXT;
ALTER TABLE "brand_settings" ADD COLUMN "invoice_pdf_payment_terms" "InvoicePdfPaymentTerms" NOT NULL DEFAULT 'DUE_ON_RECEIPT';
ALTER TABLE "brand_settings" ADD COLUMN "invoice_pdf_notes" TEXT NOT NULL DEFAULT 'Thank you for your business. Please contact us with any questions.';
