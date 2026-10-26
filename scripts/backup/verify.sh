#!/usr/bin/env bash
# Prove that a plaintext dump restores: build a scratch database from the repo's migrations, load data.sql,
# and write per-table row counts (tables.json) and CSV exports (csv/) into the dump directory.
#   verify.sh <dump-dir>      (uses the PG* environment variables for a Postgres server you can create databases on)
set -euo pipefail
dump="${1:?dump dir}"; root="$(cd "$(dirname "$0")/../.." && pwd)"
db="fwos_verify_$$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $db"
trap 'psql -q -d postgres -c "drop database if exists $db" >/dev/null' EXIT
export PGDATABASE="$db"
psql -v ON_ERROR_STOP=1 -q -f "$root/supabase/tests/00_stub.sql" >/dev/null
for m in "$root"/supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -f "$m" >/dev/null; done
( echo "set session_replication_role = replica;"; cat "$dump/data.sql" ) | psql -v ON_ERROR_STOP=1 -q >/dev/null
mkdir -p "$dump/csv"
json="{"; sep=""
for t in $(psql -Atc "select tablename from pg_tables where schemaname='public' order by 1"); do
  n="$(psql -Atc "select count(*) from public.\"$t\"")"
  json="$json$sep\"$t\": $n"; sep=", "
  psql -q -c "\\copy public.\"$t\" to '$dump/csv/$t.csv' csv header"
done
echo "$json}" > "$dump/tables.json"
echo "verified restore: $(cat "$dump/tables.json")"
