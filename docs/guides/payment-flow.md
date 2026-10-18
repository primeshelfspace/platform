# Testing the invoice → payment flow

The one flow worth clicking through end to end. Locally it runs against the
built-in fake payment gateway (`PAYMENT_GATEWAY_DRIVER=fake`, the default): no
real money, no external service, fully predictable.

Start the platform first ([getting-started.md](../getting-started.md)) and sign
in as `owner@sugrpay.test`.

## 1. Add a customer

http://localhost:3000/customers → **Add customer**.

## 2. Create and issue an invoice

http://localhost:3000/invoices → **Create invoice** → pick the customer, add a
line item or two → **Create & issue**. You land back on the invoice list with a
real payment link.

## 3. Pay it

Open the payment link (it lives on http://localhost:3001). The fake gateway
decides the outcome from the **last two digits of the amount actually charged**
— which includes the card fee when paying by card — so you can trigger each
path on purpose by adjusting a line item's price:

| Last two digits | Outcome                                                             |
| --------------- | ------------------------------------------------------------------- |
| anything else   | succeeds — invoice goes to `PAID`, balance clears                   |
| `11`            | declined — invoice returns to the status it had before              |
| `22`            | `PENDING_PAYMENT`, like a real bank (ACH) transfer, and stays there |
| `33`            | simulated gateway timeout                                           |

The card fee applies to card and wallet payments, never ACH — pay the same
invoice by two different methods to see the totals differ.

## 4. Settle a pending payment by hand

A `PENDING_PAYMENT` invoice settles only when the gateway sends a signed
webhook. There is no button for it; send one yourself:

```bash
# 1. The payment's gateway reference (the owner connection bypasses row-level security)
psql "$INVOICING_DIRECT_DATABASE_URL" -tA -c \
  "SELECT gateway_reference FROM payment WHERE invoice_id = '<invoice id>';"

# 2. Send the webhook
BODY='{"id":"evt_1","type":"PAYMENT_SUCCEEDED","gatewayReference":"<ref>","amountMinor":<amount>,"currency":"USD","occurredAt":"2026-01-01T00:00:00.000Z"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "fake-gateway-local-secret" -hex | sed 's/^.* //')
curl -X POST -H "Content-Type: application/json" -H "x-fake-signature: $SIG" \
  -d "$BODY" http://localhost:4000/public/webhooks/fake-gateway
```

`<amount>` is in minor units (cents). The signing secret
`fake-gateway-local-secret` comes from
`apps/api/src/shared/adapters/gateway/fake-gateway.adapter.ts`; it is a test
value and never a real secret.

## 5. Check the emails

Every email the flow sends (invoice, receipt, payment confirmation) appears in
the mail catcher at http://localhost:1080 — nothing leaves your machine.
