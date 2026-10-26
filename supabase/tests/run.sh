#!/usr/bin/env bash
# Applies every migration to a throwaway database and runs the SQL tests.
# Usage: PGHOST=... PGUSER=... PGPASSWORD=... ./supabase/tests/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="fwos_test_$$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $db"
trap 'psql -q -d postgres -c "drop database if exists $db" >/dev/null' EXIT
export PGDATABASE="$db"
psql -v ON_ERROR_STOP=1 -q -f "$here/00_stub.sql"
for m in "$here"/../migrations/*.sql; do echo "applying $(basename "$m")"; psql -v ON_ERROR_STOP=1 -q -f "$m"; done
for t in "$here"/[1-9]*.test.sql; do echo "running $(basename "$t")"; psql -v ON_ERROR_STOP=1 -q -t -A -o /dev/null -f "$t" && echo "  passed"; done
