#!/usr/bin/env bash
# Changes the public addresses the API uses, in one go, and restarts it.
#
# The web apps are one site on one domain, so usually one option does it:
#
#   bash deploy/set-public-urls.sh --site https://app.example.com
#     -> admin    https://app.example.com
#        accounts https://app.example.com/accounts
#        payment  https://app.example.com/pay
#
#   bash deploy/set-public-urls.sh --api https://api.example.com
#
# Each address can also be set on its own (--admin, --accounts, --payment).
# Run with no arguments to see the current values.
#
# The web apps' addresses go into emails, payment links and sign-in
# redirects. The API's address also goes into the Stripe, Square and Zoho
# OAuth callback URLs, which are updated here too.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env
URL_KEYS=(ACCOUNTS_PUBLIC_URL ADMIN_PUBLIC_URL PAYMENT_PUBLIC_URL API_PUBLIC_URL)

show() {
  for key in "${URL_KEYS[@]}" STRIPE_CONNECT_REDIRECT_URI SQUARE_CONNECT_REDIRECT_URI ZOHO_REDIRECT_URI; do
    printf '  %-28s %s\n' "$key" "$(grep -E "^$key=" "$ENV_FILE" | cut -d= -f2-)"
  done
}

set_key() {
  local key=$1 value=$2
  if grep -qE "^$key=" "$ENV_FILE"; then
    sed -i -E "s#^$key=.*#$key=$value#" "$ENV_FILE"
  else
    echo "$key=$value" >>"$ENV_FILE"
  fi
}

# https://host, or https://host/path for an app served under a path. No
# trailing slash: paths are appended to these as they are.
check_url() {
  [[ $2 =~ ^https?://[^/[:space:]]+(/[^[:space:]]*[^/[:space:]])?$ ]] || {
    echo "$1: '$2' must look like https://host or https://host/path (no trailing slash)" >&2
    exit 1
  }
}

check_host_only() {
  [[ $2 =~ ^https?://[^/[:space:]]+$ ]] || {
    echo "$1: '$2' must look like https://host (no path, no trailing slash)" >&2
    exit 1
  }
}

if [ $# -eq 0 ]; then
  echo "Current addresses in $ENV_FILE:"
  show
  exit 0
fi

changed=0
api_changed=0
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || { echo "$1 needs a URL" >&2; exit 1; }
  case $1 in
    --site)
      check_host_only "$1" "$2"
      set_key ADMIN_PUBLIC_URL "$2"
      set_key ACCOUNTS_PUBLIC_URL "$2/accounts"
      set_key PAYMENT_PUBLIC_URL "$2/pay"
      ;;
    --accounts) check_url "$1" "$2"; set_key ACCOUNTS_PUBLIC_URL "$2" ;;
    --admin) check_url "$1" "$2"; set_key ADMIN_PUBLIC_URL "$2" ;;
    --payment) check_url "$1" "$2"; set_key PAYMENT_PUBLIC_URL "$2" ;;
    --api)
      check_host_only "$1" "$2"
      set_key API_PUBLIC_URL "$2"
      set_key STRIPE_CONNECT_REDIRECT_URI "$2/integrations/stripe/callback"
      set_key SQUARE_CONNECT_REDIRECT_URI "$2/integrations/square/callback"
      set_key ZOHO_REDIRECT_URI "$2/integrations/zoho/callback"
      api_changed=1
      ;;
    *) echo "unknown option $1 (use --site, --api, --admin, --accounts or --payment)" >&2; exit 1 ;;
  esac
  changed=1
  shift 2
done

echo "Updated $ENV_FILE:"
show

if [ $changed -eq 1 ] && pm2 describe api >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --update-env >/dev/null
  echo "Restarted api and worker."
fi

cat <<'EOF'

Also change the same addresses outside this server:
  - Amplify: each web app's NEXT_PUBLIC_*_URL environment variables, then redeploy
    (they are built into the apps, so a restart is not enough).
EOF
if [ $api_changed -eq 1 ]; then
  cat <<'EOF'
  - nginx: server_name in /etc/nginx/sites-available/platform-api.conf, then
    sudo certbot --nginx -d <new api host>
  - Stripe: Connect OAuth redirect URI and the webhook endpoint URL.
  - Zoho / Square (if used): the redirect URI on their developer apps.
EOF
fi
