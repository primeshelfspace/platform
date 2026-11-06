#!/usr/bin/env bash
# Builds the current checkout on the server and switches pm2 over to it
# without taking the live APIs down. Manual deploy:
#
#   cd ~/platform && git pull && bash deploy/deploy.sh
#
# Three APIs (apps/platform, apps/sugrpay, apps/hq), each its own program.
# Each compiles into dist-build beside its live dist and is swapped in only
# once every one of them has built — a failed build exits here with the old
# versions still serving.
#
# The web app lives in primeshelfspace/sugrpay-frontend and deploys from its
# own repository (Amplify). Deploy this backend first when a release changes
# the API.
set -euo pipefail
cd "$(dirname "$0")/.."

APPS=(platform sugrpay hq)

pnpm install --frozen-lockfile
pnpm --filter "./packages/*" build

# Each API migrates its own database (its *_DIRECT_DATABASE_URL in .env). The
# databases must exist first (pnpm db:bootstrap, once per server).
pnpm --filter @platform/platform-api db:migrate
pnpm --filter @platform/sugrpay-api db:migrate
# Zoho Books connections moved from the platform's database to Sugrpay's when
# the APIs were split. Safe to repeat: only copies what Sugrpay lacks.
pnpm db:move-zoho-connections

for app in "${APPS[@]}"; do
  rm -rf "apps/$app/dist-build"
  pnpm --dir "apps/$app" exec tsc -p tsconfig.build.json --outDir dist-build
done

# --- everything built: go live ---
for app in "${APPS[@]}"; do
  rm -rf "apps/$app/dist-prev"
  if [ -d "apps/$app/dist" ]; then mv "apps/$app/dist" "apps/$app/dist-prev"; fi
  mv "apps/$app/dist-build" "apps/$app/dist"
done

pm2 startOrReload deploy/ecosystem.config.cjs --update-env

# The single API of before the split ran as 'api' and 'worker' (port 4000).
# Removed only once the new processes are running, and only when nginx no
# longer sends anything to port 4000 (see docs/operations/production.md).
if pm2 jlist | grep -q '"name":"api"' && ! sudo grep -rqs '127.0.0.1:4000' /etc/nginx/sites-enabled/; then
  pm2 delete api worker || true
fi
pm2 save

pm2 status
