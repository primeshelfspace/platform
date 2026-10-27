# Invoice email delivery tracking

What Sugrpay knows about an invoice email after it is sent, and what it takes
for it to know more.

## What happens today, with any mail server

When staff send an invoice (one invoice, or Bulk Send), Sugrpay records one row
per recipient in `mail_delivery_event` (Sugrpay's database):

| Row        | When                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SENT`     | the mail server accepted that recipient (To and CC each get one)                                                                                                                                       |
| `REJECTED` | the mail server refused that recipient while accepting the others — e.g. a mistyped CC. Shown on the invoice timeline as **Email rejected**, and returned by the send so the screen can say so at once |

If the mail server refuses **every** recipient, nothing was sent: the send fails
with a clear error and nothing is recorded as sent. If it accepts some, the send
succeeds — reporting a failure would make staff send it again and the people
who did get it would get it twice.

## Bounces and spam complaints after sending

Many problems only show up later: the receiving server bounces the message, or
the customer marks it as spam. Sugrpay can record those too — a **bounce** or
**complaint** goes on the invoice timeline, and `DELIVERED`, `OPENED`, `CLICKED`
and `DEFERRED` are kept in `mail_delivery_event` — but only if something tells
it. That is the webhook:

```
POST https://api.sugrpay.com/public/webhooks/mail      (Sugrpay API)
Content-Type: application/json
X-Sugrpay-Signature: <hex HMAC-SHA256 of the raw body, keyed with MAIL_WEBHOOK_SECRET>

{ "messageId": "<the Message-ID the send returned>",
  "type": "BOUNCED",            // DELIVERED | BOUNCED | COMPLAINED | OPENED | CLICKED | DEFERRED
  "recipient": "customer@example.com",
  "bounceKind": "HARD",         // HARD | SOFT, bounces only
  "detail": "550 mailbox unavailable",
  "occurredAt": "2026-10-28T10:00:00Z" }
```

- Unsigned or wrongly signed requests are refused; with `MAIL_WEBHOOK_SECRET`
  unset the webhook refuses everything.
- The same event delivered twice is recorded once.
- An event for a message Sugrpay never sent is ignored.
- No copy of the provider's own message is kept — only the fields above.

### Gmail (what production uses now) never calls it

Gmail / Google Workspace SMTP has no delivery webhooks: a bounce arrives as an
ordinary email in the `billing@sugrpay.com` inbox. So with Gmail, only the
`SENT` / `REJECTED` part above applies.

To get bounces and complaints on the timeline, send through a provider that
reports them — **Amazon SES** (via SNS notifications), **Postmark** or
**Resend** — and point its notifications at a small forwarder that rewrites them
into the format above and signs them. Then:

1. `openssl rand -hex 32` → set `MAIL_WEBHOOK_SECRET` on the server
   (`deploy/production/update-secrets.sh`) and in the forwarder.
2. Change `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD` to the provider's SMTP
   settings.

Choosing the provider is a business decision (cost, sending limits, domain
setup); the forwarder is a few lines once it is chosen.
