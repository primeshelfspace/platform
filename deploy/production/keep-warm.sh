#!/usr/bin/env bash
# Keeps the web app's servers awake. Amplify runs the Sugrpay web app on
# servers that are switched off after a few quiet minutes; the next click then
# waits several seconds while one starts again. Opening a few pages every two
# minutes from this box keeps them running. Cheap: three small requests.
#
# Installed once on the server (runs every 2 minutes):
#   (crontab -l 2>/dev/null | grep -v keep-warm.sh; echo "*/2 * * * * bash $HOME/platform/deploy/production/keep-warm.sh") | crontab -
#
# The pages are ones that need no sign-in but still run on the server: the
# sign-in page, the landing page and a payment page (an unknown link renders
# the "not found" state, which exercises the same server code).
SITE="${SITE_URL:-https://www.sugrpay.com}"
for path in /accounts/login /welcome /pay/i/00000000000000000000000000000000; do
  curl -s -o /dev/null --max-time 20 "$SITE$path" &
done
wait
