#!/usr/bin/env bash
# Builds the current checkout on the staging box and switches pm2 over to it
# without taking the live API down. Manual deploy:
#
#   cd ~/platform && git pull && bash deploy/deploy.sh
#
# Why not just `pnpm build` + `pm2 reload`: a build that failed halfway would
# leave the box with no usable build at all.
#
# Instead the API compiles into dist-build beside the live dist, and is
# swapped in only once it has built. A failed build exits here with the old
# version still serving.
#
# The web apps live in primeshelfspace/sugrpay-frontend and deploy from their
# own checkout (its deploy/deploy.sh). Deploy this backend first when a
# release changes the API.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
pnpm --filter "./packages/*" build

# Reads each module's *_DIRECT_DATABASE_URL from this box's own .env. The
# module databases must exist first (pnpm db:bootstrap, once per box).
pnpm --filter @platform/api db:migrate

rm -rf apps/api/dist-build
pnpm --filter @platform/api exec tsc -p tsconfig.build.json --outDir dist-build

# --- everything built: go live ---
rm -rf apps/api/dist-prev
if [ -d apps/api/dist ]; then mv apps/api/dist apps/api/dist-prev; fi
mv apps/api/dist-build apps/api/dist

# Processes started before the Fenwick -> Sugrpay rename still run
# `--filter @fenwick/*`, and reload never refreshes a process's args — so
# recreate them once; every later deploy just reloads.
if pm2 jlist | grep -q '@fenwick/'; then pm2 delete deploy/ecosystem.config.cjs; fi
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

pm2 status
