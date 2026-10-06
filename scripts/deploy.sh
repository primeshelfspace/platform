#!/usr/bin/env bash
# Builds the current checkout on the staging box and switches pm2 over to it
# without taking the live apps down. Used by .github/workflows/deploy.yml and
# for manual deploys:
#
#   cd ~/Multi-Brand-Invoicing && git pull && bash scripts/deploy.sh
#
# Why not just `pnpm build` + `pm2 reload`: `next build` empties .next before
# it writes the new build, and the running `next start` reads pages and chunks
# from that same .next lazily. For the whole build every request either hit
# missing files or crashed the process, and nginx answered 502; a build that
# failed halfway left the box with no usable build at all.
#
# Instead every app builds beside the live one, and nothing live is touched
# until ALL of them have built:
#   - admin / payment build into the idle slot (.next-a or .next-b, recorded in
#     apps/<app>/.next-slot, which ecosystem.config.cjs hands to next start).
#   - the API compiles into dist-build and is swapped into dist at the end.
# A failed build exits here with the old version still serving.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
pnpm --filter @sugrpay/shared build
pnpm --filter @sugrpay/ui build

# Reads DIRECT_DATABASE_URL from this box's own .env.
pnpm --filter @sugrpay/api db:migrate

rm -rf apps/api/dist-build
pnpm --filter @sugrpay/api exec tsc -p tsconfig.build.json --outDir dist-build

declare -A slot
for app in admin payment; do
  dir="apps/$app"
  live=$(cat "$dir/.next-slot" 2>/dev/null || echo .next)
  if [ "$live" = .next-a ]; then slot[$app]=.next-b; else slot[$app]=.next-a; fi

  rm -rf "${dir:?}/${slot[$app]}"
  # Route types are build-time only. The live build's would be typechecked
  # alongside the new ones and fail the build on any route this deploy removed.
  rm -rf "${dir:?}/$live/types"

  NEXT_DIST_DIR=${slot[$app]} pnpm --filter "@sugrpay/$app" build
done

# next build rewrites these to point at the slot it built into; keep the
# tracked copies clean so the next `git reset --hard` / `git pull` is quiet.
git checkout -- apps/admin/next-env.d.ts apps/payment/next-env.d.ts

# --- everything built: go live ---
rm -rf apps/api/dist-prev
if [ -d apps/api/dist ]; then mv apps/api/dist apps/api/dist-prev; fi
mv apps/api/dist-build apps/api/dist
for app in admin payment; do echo "${slot[$app]}" > "apps/$app/.next-slot"; done

# Processes started before the Fenwick -> Sugrpay rename still run
# `--filter @fenwick/*`, and reload never refreshes a process's args — so
# recreate them once; every later deploy just reloads.
if pm2 jlist | grep -q '@fenwick/'; then pm2 delete ecosystem.config.cjs; fi
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

# The pre-slot build is unused once every app is on a slot.
rm -rf apps/admin/.next apps/payment/.next

pm2 status
