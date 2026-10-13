-- CreateEnum
CREATE TYPE "BrandStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('SOLE_PROPRIETORSHIP', 'LLC', 'CORPORATION', 'PARTNERSHIP', 'NONPROFIT');

-- CreateEnum
CREATE TYPE "PaymentPageLayout" AS ENUM ('BANNER', 'CENTERED', 'SPLIT');

-- CreateEnum
CREATE TYPE "EmailReceiptLayout" AS ENUM ('CLASSIC', 'HERO', 'MINIMAL');

-- CreateEnum
CREATE TYPE "InvoicePdfLayout" AS ENUM ('CLASSIC', 'MODERN', 'MINIMAL');

-- CreateEnum
CREATE TYPE "InvoicePdfPaymentTerms" AS ENUM ('DUE_ON_RECEIPT', 'NET_15', 'NET_30', 'NET_60');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('BUSINESS', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'PENDING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'WALLET', 'ACH', 'CHECK', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PROCESSING', 'SETTLED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('ZOHO_BOOKS', 'NUMBERS_GATEWAY', 'SHOPIFY', 'STRIPE', 'PAYPAL', 'SQUARE', 'AUTHORIZE_NET');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('PUSH', 'PULL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'SKIPPED', 'FAILED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "SyncErrorClass" AS ENUM ('TRANSIENT', 'AUTHENTICATION', 'VALIDATION', 'CONFLICT', 'PERMANENT');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PendingAssignmentStatus" AS ENUM ('PENDING', 'ASSIGNED');

-- CreateEnum
CREATE TYPE "PendingAssignmentReason" AS ENUM ('NEW_RECORD_MULTI_BRAND', 'ORPHANED_UPDATE');

-- CreateTable
CREATE TABLE "brand" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "sales_person" TEXT,
    "business_type" "BusinessType",
    "phone" TEXT,
    "email" TEXT,
    "mailing_address" JSONB,
    "billing_address" JSONB,
    "tax_id" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "theme_color" TEXT NOT NULL DEFAULT '#2D6A6A',
    "logo_key" TEXT,
    "status" "BrandStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "replicated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_settings" (
    "brand_id" UUID NOT NULL,
    "invoice_prefix" TEXT NOT NULL DEFAULT 'INV',
    "next_sequence" INTEGER NOT NULL DEFAULT 1,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "late_fee_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "default_tax_rate_id" UUID,
    "card_fee_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "partial_payment_enabled" BOOLEAN NOT NULL DEFAULT false,
    "reminder_schedule" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "card_enabled" BOOLEAN NOT NULL DEFAULT true,
    "apple_pay_enabled" BOOLEAN NOT NULL DEFAULT false,
    "google_pay_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ach_enabled" BOOLEAN NOT NULL DEFAULT false,
    "check_enabled" BOOLEAN NOT NULL DEFAULT false,
    "accent_color" TEXT NOT NULL DEFAULT '#171717',
    "payment_page_layout" "PaymentPageLayout" NOT NULL DEFAULT 'BANNER',
    "email_receipt_layout" "EmailReceiptLayout" NOT NULL DEFAULT 'CLASSIC',
    "email_receipt_subject" TEXT NOT NULL DEFAULT 'New invoice from {{brand_name}}',
    "email_receipt_body" TEXT NOT NULL DEFAULT 'Hi {{customer_name}},

This is an automated message from {{brand_name}} regarding invoice {{invoice_number}}.

Amount due: {{amount_due}}
Due date: {{due_date}}

Please click the button below to view and pay your invoice.

Thank you for your business.',
    "payment_confirmation_subject" TEXT NOT NULL DEFAULT 'Payment received for invoice {{invoice_number}}',
    "payment_confirmation_body" TEXT NOT NULL DEFAULT 'Hi {{customer_name}},

We''ve received your payment of {{amount_due}} for invoice {{invoice_number}} from {{brand_name}}.

Thank you for your business.',
    "payment_failed_subject" TEXT NOT NULL DEFAULT 'Payment failed for invoice {{invoice_number}}',
    "payment_failed_body" TEXT NOT NULL DEFAULT 'Hi {{customer_name}},

We were unable to process your payment of {{amount_due}} for invoice {{invoice_number}} from {{brand_name}}.

Please try again or contact us for help.',
    "invoice_pdf_layout" "InvoicePdfLayout" NOT NULL DEFAULT 'CLASSIC',
    "invoice_pdf_show_company_address" BOOLEAN NOT NULL DEFAULT true,
    "invoice_pdf_show_payment_terms" BOOLEAN NOT NULL DEFAULT true,
    "invoice_pdf_show_tax_breakdown" BOOLEAN NOT NULL DEFAULT true,
    "invoice_pdf_show_notes" BOOLEAN NOT NULL DEFAULT true,
    "invoice_pdf_company_name" TEXT,
    "invoice_pdf_company_address" TEXT,
    "invoice_pdf_payment_terms" "InvoicePdfPaymentTerms" NOT NULL DEFAULT 'DUE_ON_RECEIPT',
    "invoice_pdf_notes" TEXT NOT NULL DEFAULT 'Thank you for your business. Please contact us with any questions.',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_settings_pkey" PRIMARY KEY ("brand_id")
);

-- CreateTable
CREATE TABLE "tax_rate" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "zoho_tax_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'BUSINESS',
    "salutation" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "company_name" TEXT,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "billing_address" JSONB,
    "shipping_address" JSONB,
    "zoho_contact_id" TEXT,
    "zoho_synced_version" TIMESTAMP(3),
    "zoho_unsynced_reason" TEXT,
    "notes" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contact_person" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "zoho_contact_person_id" TEXT,
    "salutation" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "skype" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "is_primary_contact" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contact_person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_rate_bp_applied" INTEGER NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "card_fee_rate_bp_applied" INTEGER NOT NULL DEFAULT 0,
    "card_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "public_token" TEXT NOT NULL,
    "public_token_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "internal_notes" TEXT,
    "zoho_invoice_id" TEXT,
    "zoho_synced_version" TIMESTAMP(3),
    "zoho_missing_since" TIMESTAMP(3),
    "zoho_unsynced_reason" TEXT,
    "tax_rate_id" UUID,
    "issued_at" TIMESTAMP(3),
    "first_viewed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "previous_status" "InvoiceStatus",
    "overdue" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_item" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "item_name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,
    "tax_exempt" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "gateway_reference" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "last_event_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "settled_at" TIMESTAMP(3),
    "refunded_minor" BIGINT NOT NULL DEFAULT 0,
    "zoho_payment_id" TEXT,
    "zoho_unsynced_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_event" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" "InvoiceStatus",
    "to_status" "InvoiceStatus",
    "actor" TEXT NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_submission" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "check_number" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "front_image_key" TEXT NOT NULL,
    "back_image_key" TEXT NOT NULL,
    "customer_note" TEXT,
    "status" "CheckStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewed_by" UUID,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_job" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error_class" "SyncErrorClass",
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_brand_assignment" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "organization_id" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "remote_id" TEXT NOT NULL,
    "reason" "PendingAssignmentReason" NOT NULL,
    "status" "PendingAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "assigned_brand_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_brand_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_event" (
    "event_id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "brand_merchant_id_idx" ON "brand"("merchant_id");

-- CreateIndex
CREATE INDEX "tax_rate_brand_id_idx" ON "tax_rate"("brand_id");

-- CreateIndex
CREATE INDEX "customer_brand_id_idx" ON "customer"("brand_id");

-- CreateIndex
CREATE INDEX "customer_brand_id_status_idx" ON "customer"("brand_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_brand_id_zoho_contact_id_key" ON "customer"("brand_id", "zoho_contact_id");

-- CreateIndex
CREATE INDEX "customer_contact_person_customer_id_idx" ON "customer_contact_person"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contact_person_customer_id_zoho_contact_person_id_key" ON "customer_contact_person"("customer_id", "zoho_contact_person_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_public_token_key" ON "invoice"("public_token");

-- CreateIndex
CREATE INDEX "invoice_brand_id_status_idx" ON "invoice"("brand_id", "status");

-- CreateIndex
CREATE INDEX "invoice_brand_id_due_date_idx" ON "invoice"("brand_id", "due_date");

-- CreateIndex
CREATE INDEX "invoice_customer_id_idx" ON "invoice"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_brand_id_number_key" ON "invoice"("brand_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_brand_id_zoho_invoice_id_key" ON "invoice"("brand_id", "zoho_invoice_id");

-- CreateIndex
CREATE INDEX "line_item_invoice_id_idx" ON "line_item"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "line_item_invoice_id_position_key" ON "line_item"("invoice_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateway_reference_key" ON "payment"("gateway_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_idempotency_key_key" ON "payment"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_invoice_id_idx" ON "payment"("invoice_id");

-- CreateIndex
CREATE INDEX "payment_brand_id_status_idx" ON "payment"("brand_id", "status");

-- CreateIndex
CREATE INDEX "payment_zoho_payment_id_idx" ON "payment"("zoho_payment_id");

-- CreateIndex
CREATE INDEX "invoice_event_invoice_id_occurred_at_idx" ON "invoice_event"("invoice_id", "occurred_at");

-- CreateIndex
CREATE INDEX "check_submission_brand_id_status_idx" ON "check_submission"("brand_id", "status");

-- CreateIndex
CREATE INDEX "sync_job_brand_id_status_idx" ON "sync_job"("brand_id", "status");

-- CreateIndex
CREATE INDEX "sync_job_status_next_attempt_at_idx" ON "sync_job"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "pending_brand_assignment_merchant_id_status_idx" ON "pending_brand_assignment"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pending_brand_assignment_provider_organization_id_object_ty_key" ON "pending_brand_assignment"("provider", "organization_id", "object_type", "remote_id");

-- AddForeignKey
ALTER TABLE "brand_settings" ADD CONSTRAINT "brand_settings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_person" ADD CONSTRAINT "customer_contact_person_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_item" ADD CONSTRAINT "line_item_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_event" ADD CONSTRAINT "invoice_event_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_submission" ADD CONSTRAINT "check_submission_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_submission" ADD CONSTRAINT "check_submission_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_job" ADD CONSTRAINT "sync_job_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_brand_assignment" ADD CONSTRAINT "pending_brand_assignment_assigned_brand_id_fkey" FOREIGN KEY ("assigned_brand_id") REFERENCES "brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

