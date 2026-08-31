-- Deletion reconciliation (G-02).
--
-- Neither pipeline could see a deletion. The invoice pull is incremental — it
-- asks Zoho only for invoices modified since the last cursor — so an invoice
-- deleted in Zoho simply stops being mentioned, and nothing here noticed. The
-- local row kept its status AND its publicToken, and public_token_active stayed
-- true, so an invoice that no longer existed in the books remained collectable
-- through the public payment page. That is the one open gap that could take
-- real money for a record Zoho no longer has.
--
-- This column records when a full reconciliation scan first failed to find the
-- invoice in Zoho. Setting it also deactivates the public token, which is what
-- actually closes the exposure (PublicInvoicesService.resolveScope already
-- refuses a token whose public_token_active is false).
--
-- Deliberately NOT changing invoice status on absence: a full-scan diff is
-- inferring deletion from silence, and if Zoho ever applies an unexpected
-- default filter to the invoice list, that inference is wrong. Deactivating a
-- token is reversible and costs a merchant one re-send; rewriting an invoice's
-- status on a false positive corrupts the ledger. So absence stops collection
-- and flags for a human, and the column is cleared if the invoice reappears.
ALTER TABLE "invoice" ADD COLUMN "zoho_missing_since" TIMESTAMP(3);

-- Finding the rows to reconcile means "every invoice for this brand that came
-- from, or was pushed to, Zoho" — a partial index because rows with no
-- zoho_invoice_id are irrelevant to a Zoho diff and are the majority for any
-- brand that is not connected.
CREATE INDEX "invoice_brand_id_zoho_invoice_id_present_idx"
  ON "invoice"("brand_id")
  WHERE "zoho_invoice_id" IS NOT NULL;
