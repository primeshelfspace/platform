#!/usr/bin/env bash
# Waits until each name's DNS points at this server, then asks Let's Encrypt
# for its certificate (certbot adds HTTPS and the HTTP -> HTTPS redirect to
# the nginx site that already serves the name). Each name is done once; the
# script exits when all are done, or after 7 days.
#
#   nohup bash deploy/production/cert-when-dns-ready.sh platform-api.sugrpay.com sugrpay-api.sugrpay.com hq-api.sugrpay.com > ~/cert-apis.log 2>&1 &
#
# Progress: tail ~/cert-apis.log
set -u
IP="${SERVER_IP:-13.56.132.111}"
DEADLINE=$(( $(date +%s) + 7 * 24 * 3600 ))
pending=("$@")

while [ ${#pending[@]} -gt 0 ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do
  still=()
  for name in "${pending[@]}"; do
    # Ask a public resolver, not the local cache: Let's Encrypt checks from outside.
    resolved=$(dig +short "$name" @8.8.8.8 | tail -1)
    if [ "$resolved" != "$IP" ]; then
      still+=("$name")
      continue
    fi
    echo "$(date -u +%FT%TZ) $name -> $IP, requesting certificate"
    if sudo certbot --nginx -d "$name" --non-interactive --redirect --keep-until-expiring; then
      echo "$(date -u +%FT%TZ) $name: HTTPS on"
    else
      echo "$(date -u +%FT%TZ) $name: certbot failed, will retry"
      still+=("$name")
    fi
  done
  pending=("${still[@]+"${still[@]}"}")
  [ ${#pending[@]} -gt 0 ] && sleep 300
done

if [ ${#pending[@]} -eq 0 ]; then
  echo "$(date -u +%FT%TZ) all names have HTTPS"
else
  echo "$(date -u +%FT%TZ) gave up waiting for DNS: ${pending[*]}"
fi
