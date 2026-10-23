#!/usr/bin/env bash
# Changes secrets (and a few settings) in the server's .env without anyone
# having to edit it by hand, then restarts the API and worker.
#
#   1. On your own computer, write a file with only the lines you want to change:
#        SMTP_PASSWORD=abcd efgh ijkl mnop
#        STRIPE_SECRET_KEY=sk_live_...
#   2. Copy it to the server as ~/prod-secrets.env, e.g. from PowerShell:
#        Get-Content -Raw prod-secrets.env | ssh -i platform-key.pem ubuntu@<server> "umask 077; cat > ~/prod-secrets.env"
#   3. On the server:  bash ~/platform/deploy/production/update-secrets.sh
#   4. Delete the file from your computer.
#
# Only the keys listed below are taken; empty lines keep the current value.
# The result is checked with the API's own config schema first — if it is
# invalid, nothing changes. The previous .env is kept as .env.bak-<timestamp>.
# ~/prod-secrets.env is shredded when this script ends, whatever happens.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
SECRETS="${SECRETS_FILE:-$HOME/prod-secrets.env}"
trap 'shred -u "$SECRETS" 2>/dev/null || rm -f "$SECRETS"' EXIT
[ -f "$SECRETS" ] || { echo "no $SECRETS"; exit 1; }

KEYS=(
  INTERNAL_API_KEY
  SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD MAIL_FROM
  S3_BUCKET S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
  STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_CONNECT_CLIENT_ID STRIPE_WEBHOOK_SECRET
  SQUARE_APPLICATION_ID SQUARE_APPLICATION_SECRET SQUARE_ENVIRONMENT
  ZOHO_CLIENT_ID ZOHO_CLIENT_SECRET ZOHO_WEBHOOK_SECRET ZOHO_API_DOMAIN ZOHO_ACCOUNTS_DOMAIN
  ZOHO_SCHEDULED_PULL_ENABLED ACCOUNTING_DRIVER PAYMENT_GATEWAY_DRIVER
)

NEW=$(mktemp "$REPO/.env.new.XXXX")
chmod 600 "$NEW"
cp .env "$NEW"
changed=""
for key in "${KEYS[@]}"; do
  value=$(grep -E "^$key=" "$SECRETS" | head -1 | cut -d= -f2- | tr -d '\r' || true)
  [ -n "$value" ] || continue
  # Google shows app passwords in groups of four; the spaces are not part of it.
  [ "$key" = SMTP_PASSWORD ] && { value=${value//\"/}; value=${value// /}; }
  tmp=$(mktemp)
  chmod 600 "$tmp"
  # awk, not sed: the value is written byte for byte (sed treats & and \ specially).
  KEY="$key" VALUE="$value" awk 'BEGIN{d=0}
    index($0, ENVIRON["KEY"] "=")==1 {print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; d=1; next}
    {print}
    END{if(!d) print ENVIRON["KEY"] "=" ENVIRON["VALUE"]}' "$NEW" >"$tmp"
  mv "$tmp" "$NEW"
  changed="$changed $key"
done
[ -n "$changed" ] || { rm -f "$NEW"; echo "Nothing to update (no listed keys had a value)."; exit 1; }

if ! env -i HOME="$HOME" PATH="$PATH" NODE_ENV=production node deploy/production/check-env.mjs "$NEW"; then
  rm -f "$NEW"
  echo "Nothing changed."
  exit 1
fi
cp .env ".env.bak-$(date +%s)"
chmod 600 .env.bak-*
mv "$NEW" .env
pm2 reload deploy/ecosystem.config.cjs --update-env >/dev/null
echo "Updated:$changed — api and worker reloaded."
