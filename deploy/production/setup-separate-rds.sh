#!/usr/bin/env bash
# Creates each module's database and its two logins when each module has its
# OWN RDS server (as production does: platform and invoicing-db). With a single
# server, use `pnpm db:bootstrap` and DATABASE_ADMIN_URL instead. Per module:
#   - <module>_owner and <module>_app logins, with the passwords already in .env
#   - the database, owned by <module>_owner
#   - nobody but those two logins may connect to it
# Safe to run again. Asks for each RDS server's master login; the password is
# typed hidden and is not stored anywhere — or read once from ~/rds-master.env
# (PLATFORM_MASTER_USER/PASSWORD, INVOICING_MASTER_USER/PASSWORD), which is
# shredded when the script ends.
#
#   bash ~/platform/deploy/production/setup-separate-rds.sh
#   pnpm --filter @platform/api db:migrate      # then create the tables
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

run_module() {
  local module=$1 label=${1,,} sql host master attempt
  sql=$(cd "$REPO" && node deploy/production/setup-separate-rds-sql.mjs "$module") || { echo "could not read $REPO/.env"; exit 1; }
  host=$(printf '%s\n' "$sql" | sed -n '1s/^-- host //p')

  echo
  echo "== $label database on $host"
  local file_user_var="${module}_MASTER_USER" file_pass_var="${module}_MASTER_PASSWORD"
  for attempt in 1 2 3; do
    if [ -n "${!file_pass_var:-}" ]; then
      # From ~/rds-master.env: one try only, no prompts.
      master=${!file_user_var:-postgres}
      PGPASSWORD=${!file_pass_var}
      echo "   using the master login from ~/rds-master.env"
    else
      read -r -p "Master username [postgres]: " master
      master=${master:-postgres}
      read -r -s -p "Master password for $master (hidden, paste with right-click): " PGPASSWORD
      echo
    fi
    if [ -z "$PGPASSWORD" ]; then
      echo "   No password received. Try again."
      continue
    fi
    export PGPASSWORD PGHOST=$host PGPORT=5432 PGDATABASE=postgres PGUSER=$master PGSSLMODE=require
    if printf '%s\n' "$sql" | psql -v ON_ERROR_STOP=1 -q -X; then
      unset PGPASSWORD PGHOST PGPORT PGDATABASE PGUSER PGSSLMODE
      break
    fi
    unset PGPASSWORD PGHOST PGPORT PGDATABASE PGUSER PGSSLMODE
    if [ -n "${!file_pass_var:-}" ]; then
      echo "   Setting up $label failed with the login from rds-master.env (see the message above)."
      exit 1
    fi
    if [ "$attempt" = 3 ]; then
      echo "   Gave up on $label after 3 tries. Check the master password in the RDS console (Modify -> New master password) and run this again."
      exit 1
    fi
    echo "   That did not work (see the message above). Try again."
  done

  # Prove both new logins work with the passwords in .env.
  local url ok=1 who
  for var in "${module}_DIRECT_DATABASE_URL" "${module}_DATABASE_URL"; do
    url=$(grep -E "^$var=" "$REPO/.env" | cut -d= -f2- | sed 's/?.*//')
    who=$(psql "$url?sslmode=require" -X -tAc 'select current_user' 2>&1 | head -1)
    printf '   login %-30s %s\n' "$var" "$who"
    [[ $who == *_owner || $who == *_app ]] || ok=0
  done
  if [ $ok = 1 ]; then
    echo "✓ $label: database and logins ready"
  else
    echo "✗ $label: the logins do not work yet"
    exit 1
  fi
}

# Optional: master logins from a file instead of typing them. The file is
# removed when this script ends, whether or not it succeeded.
if [ -f ~/rds-master.env ]; then
  trap 'shred -u ~/rds-master.env 2>/dev/null || rm -f ~/rds-master.env' EXIT
  set -a
  # shellcheck disable=SC1090
  . <(grep -E '^(PLATFORM|INVOICING)_MASTER_(USER|PASSWORD)=' ~/rds-master.env | tr -d '\r')
  set +a
fi

run_module PLATFORM
run_module INVOICING
echo
echo "Done."
