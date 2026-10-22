#!/usr/bin/env bash
# Gets a Let's Encrypt HTTPS certificate for one host name, retrying until DNS
# has caught up.
#
#   sudo cp ~/platform/deploy/nginx/api.conf /etc/nginx/sites-available/…   (server_name set)
#   bash ~/platform/deploy/production/request-certificate.sh api.example.com
#
# Right after a DNS change, some resolvers (including Let's Encrypt's) still
# hold the old address for as long as the old record's TTL, and the request
# fails with "Invalid response from <old ip>". This tries every 20 minutes for
# up to 8 hours — three tries an hour, under Let's Encrypt's limit of five
# failed validations an hour. Run it in the background:
#
#   setsid nohup bash ~/platform/deploy/production/request-certificate.sh api.example.com \
#     > ~/cert-api.out 2>&1 < /dev/null & disown
#
# The nginx server block for the name must exist first (port 80, server_name
# set); certbot adds the HTTPS listener and the HTTP -> HTTPS redirect to it.
# Renewal is automatic afterwards (certbot.timer).
set -uo pipefail
DOMAIN="${1:?usage: request-certificate.sh <host name>}"
LOG="$HOME/cert-$DOMAIN.log"

for attempt in $(seq 1 24); do
  echo "$(date -u +%FT%TZ) attempt $attempt for $DOMAIN"
  if sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email --redirect >>"$LOG" 2>&1; then
    echo "$(date -u +%FT%TZ) CERTIFICATE OK"
    exit 0
  fi
  grep -oE "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+: Invalid response" "$LOG" | tail -1 |
    sed "s/^/    seen by Let's Encrypt: /"
  sleep 1200
done
echo "$(date -u +%FT%TZ) GAVE UP after 8 hours — see $LOG"
exit 1
