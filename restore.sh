#!/usr/bin/env bash
# Restore a Family Wealth OS backup into an EMPTY database that already has the schema
# (apply supabase/migrations first, or use schema.sql from the archive for a plain Postgres).
#
#   restore.sh <archive.tar.gz.age> <age-identity-file> <target-database-url> [--with-auth]
#
# Example (new Supabase project, run from the repo root after applying migrations):
#   scripts/backup/restore.sh fwos-latest.tar.gz.age ~/fwos-backup-key.txt "postgresql://postgres:PASSWORD@HOST:5432/postgres"
#
# --with-auth also loads auth_data.sql (login accounts) when the archive contains it.
set -euo pipefail
archive="${1:?archive}"; identity="${2:?age identity file}"; db="${3:?target database url}"; with_auth="${4:-}"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
age -d -i "$identity" "$archive" | tar -C "$work" -xzf -
d="$work/fwos-backup"
echo "Backup created: $(grep -o '"created_utc": "[^"]*"' "$d/manifest.json")"
( cd "$d" && while IFS= read -r line; do
    f="$(echo "$line" | sed -n 's/^ *"\([^"]*\)": "\([0-9a-f]\{64\}\)",\{0,1\}$/\1/p')"
    h="$(echo "$line" | sed -n 's/^ *"\([^"]*\)": "\([0-9a-f]\{64\}\)",\{0,1\}$/\2/p')"
    if [ -n "$f" ]; then
      echo "$h  $f" | sha256sum -c --quiet - || { echo "CHECKSUM MISMATCH: $f" >&2; exit 1; }
    fi
  done < manifest.json )
echo "Checksums OK"
nrows="$(psql "$db" -Atc "select count(*) from public.households" 2>/dev/null || echo err)"
[ "$nrows" = "0" ] || { echo "Target must have the schema and be EMPTY (public.households count: $nrows). Aborting." >&2; exit 1; }
if [ "$with_auth" = "--with-auth" ] && [ -s "$d/auth_data.sql" ]; then
  echo "Loading login accounts"; ( echo "set session_replication_role = replica;"; cat "$d/auth_data.sql" ) | psql "$db" -v ON_ERROR_STOP=1 -q
fi
echo "Loading data"
( echo "set session_replication_role = replica;"; cat "$d/data.sql" ) | psql "$db" -v ON_ERROR_STOP=1 -q
echo "Restore finished. Row count in public.households: $(psql "$db" -Atc 'select count(*) from public.households')"
