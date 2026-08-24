-- Drop the old single-column index, superseded by the composite unique
-- constraint below — nothing queries zoho_contact_id without brand_id
-- alongside it, so the plain index was never actually the right shape.
DROP INDEX "customer_zoho_contact_id_idx";

-- Real uniqueness, not just an index: ZohoPullService's per-record detail
-- fetches now run several in flight at once (mapWithConcurrency), so two
-- concurrent pulls racing to create the same not-yet-seen Zoho contact (e.g.
-- two invoices for one new customer, pulled in the same batch) must fail one
-- of them at the database rather than silently doubling the customer.
-- pullOneCustomer upserts on this.
CREATE UNIQUE INDEX "customer_brand_id_zoho_contact_id_key" ON "customer"("brand_id", "zoho_contact_id");

-- Same reasoning for invoices — pullOneInvoice's cascade can race when two
-- concurrently-pulled payments reference the same not-yet-seen invoice (e.g.
-- two partial payments on it) in the same mapWithConcurrency batch.
-- pullOneInvoice upserts on this.
CREATE UNIQUE INDEX "invoice_brand_id_zoho_invoice_id_key" ON "invoice"("brand_id", "zoho_invoice_id");

-- Payments don't need the same treatment: a concurrent duplicate already
-- fails on the existing unique idempotency_key ("zoho:<payment_id>"). This
-- plain index is what lets ZohoPullService.pullPayments skip re-fetching
-- detail for a payment it has already pulled, without a table scan.
CREATE INDEX "payment_zoho_payment_id_idx" ON "payment"("zoho_payment_id");
