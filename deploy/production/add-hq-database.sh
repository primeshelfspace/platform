#!/usr/bin/env bash
# One-time: gives the HQ API its own database on its own RDS server, the way
# Sugrpay has its own. Run on the server, after deploying the code that has it:
#
#   bash ~/platform/deploy/production/add-hq-database.sh <hq-rds-endpoint>
#
# It:
#   1. backs up .env, then adds HQ_DATABASE_URL, HQ_DIRECT_DATABASE_URL (with
#      new random passwords for the hq_app and hq_owner logins) and
#      HQ_INTERNAL_URL;
#   2. asks for the HQ RDS master login (the password is typed hidden and is
#      never written to disk or printed) and creates the hq database and its
#      two logins (pnpm db:bootstrap hq);
#   3. creates HQ's tables (migrations) and restarts the APIs;
#   4. asks the platform to announce every brand, so HQ's copy fills.
#
# Safe to stop and run again: step 1 is skipped when .env already has
# HQ_DATABASE_URL, and steps 2-4 are idempotent.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "usage: bash deploy/production/add-hq-database.sh <hq-rds-endpoint>"
  exit 1
fi

urlencode() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

# 1. Settings ---------------------------------------------------------------
if grep -q '^HQ_DATABASE_URL=' .env; then
  echo "== .env already has HQ_DATABASE_URL: keeping it"
else
  backup=".env.backup-$(date +%Y%m%d-%H%M%S)"
  cp .env "$backup"
  chmod 600 "$backup"
  app_pw=$(openssl rand -hex 24)
  owner_pw=$(openssl rand -hex 24)
  {
    echo
    echo "# HQ's own database (deploy/production/add-hq-database.sh, $(date -u +%F))"
    echo "HQ_DATABASE_URL=postgresql://hq_app:${app_pw}@${HOST}:5432/hq?schema=public&sslmode=require"
    echo "HQ_DIRECT_DATABASE_URL=postgresql://hq_owner:${owner_pw}@${HOST}:5432/hq?schema=public&sslmode=require"
    grep -q '^HQ_INTERNAL_URL=' .env || echo "HQ_INTERNAL_URL=http://127.0.0.1:4003"
  } >> .env
  chmod 600 .env
  echo "== Added the HQ database settings to .env (backup: $backup)"
fi

# 2. Database and logins ----------------------------------------------------
echo
echo "== Creating the hq database and its logins on $HOST"
read -r -p "HQ RDS master username [postgres]: " master
master=${master:-postgres}
read -r -s -p "HQ RDS master password (hidden): " master_pw
echo
if [ -z "$master_pw" ]; then
  echo "No password received; nothing changed in the database. Run this again."
  exit 1
fi
admin_url="postgresql://$(urlencode "$master"):$(urlencode "$master_pw")@${HOST}:5432/postgres?sslmode=require"
# Passed to this one command only: never stored.
HQ_DATABASE_ADMIN_URL="$admin_url" pnpm db:bootstrap hq
unset master_pw admin_url

# 3. Tables, then restart ---------------------------------------------------
echo
echo "== Creating HQ's tables"
pnpm --filter @platform/hq-api db:migrate
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

echo "== Waiting for the HQ API"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4003/health/ready > /dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:4003/health/ready > /dev/null || {
  echo "The HQ API is not ready: see pm2 logs hq-api"
  exit 1
}

# 4. Fill HQ's copy of the brands --------------------------------------------
key=$(grep '^INTERNAL_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"')
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4001/health/live > /dev/null 2>&1; then break; fi
  sleep 2
done
result=$(curl -fsS -X POST -H "x-internal-key: ${key}" http://127.0.0.1:4001/internal/brands/republish)
echo "== Announced every brand to HQ: $result"
echo
echo "Done. HQ has its own database; check: curl -s http://127.0.0.1:4003/health/ready"
