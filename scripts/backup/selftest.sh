#!/usr/bin/env bash
# End-to-end test of the backup chain against a throwaway local Postgres (no Supabase needed):
# dump -> verify -> package (encrypt) -> restore into an empty database -> compare row counts.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$root"
tmp="$(mktemp -d)"; src="fwos_bsrc_$$"; dst="fwos_bdst_$$"; dst2="fwos_bdst2_$$"
cleanup() { for d in "$src" "$dst" "$dst2"; do psql -q -d postgres -c "drop database if exists $d" >/dev/null 2>&1 || true; done; rm -rf "$tmp"; }
trap cleanup EXIT
fail() { echo "SELFTEST FAILED: $*" >&2; exit 1; }

mkdb() { psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $1"
  psql -v ON_ERROR_STOP=1 -q -d "$1" -f supabase/tests/00_stub.sql >/dev/null
  for m in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$m" >/dev/null; done; }

# 1. source database with realistic sample rows
mkdb "$src"
psql -v ON_ERROR_STOP=1 -q -d "$src" >/dev/null <<'SQL'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'a@example.test');
insert into households (id, name) values ('11111111-1111-1111-1111-111111111111', 'Sample');
insert into household_members values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000aa', 'admin');
insert into owners (id, household_id, display_name) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Owner, "Quoted"');
insert into assets (id, household_id, type, owner_id, nickname) values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'bank_account', '22222222-2222-2222-2222-222222222222', E'Line1\nLine2');
insert into observations (household_id, asset_id, kind, amount, as_of, source, confidence)
  select household_id, id, 'balance', 12345.67, date '2026-10-01', 'manual', 'manual_confirmed' from assets;
SQL

# 2. dump like `supabase db dump` would (public schema; schema + data)
dump="$tmp/dump"; mkdir "$dump"
pg_dump -d "$src" --schema=public --schema-only --no-owner --no-privileges -f "$dump/schema.sql"
pg_dump -d "$src" --schema=public --data-only --no-owner -f "$dump/data.sql"

# 3. verify restore + csv + counts
scripts/backup/verify.sh "$dump" >/dev/null
[ -s "$dump/csv/owners.csv" ] || fail "csv export missing"
grep -q '"households": 1' "$dump/tables.json" || fail "row counts not recorded: $(cat "$dump/tables.json")"

# 4. encrypt
age-keygen -o "$tmp/key.txt" 2>"$tmp/keygen.log"
pub="$(grep -o 'age1[a-z0-9]*' "$tmp/keygen.log" | head -1)"
( unset AGE_RECIPIENT; scripts/backup/package.sh "$dump" "$tmp/out" >/dev/null 2>&1 ) && fail "package.sh must refuse to run without a key"
archive="$(AGE_RECIPIENT="$pub" scripts/backup/package.sh "$dump" "$tmp/out")"
[ -s "$archive" ] || fail "archive not created"
grep -q "Sample" "$archive" && fail "archive contains plaintext"

# 5. restore into an empty database and compare
mkdb "$dst"
scripts/backup/restore.sh "$archive" "$tmp/key.txt" "dbname=$dst" >"$tmp/restore.log" 2>&1 || { cat "$tmp/restore.log" >&2; fail "restore failed"; }
for t in households household_members owners assets observations audit_events; do
  a="$(psql -Atd "$src" -c "select count(*) from public.$t")"; b="$(psql -Atd "$dst" -c "select count(*) from public.$t")"
  [ "$a" = "$b" ] || fail "row count differs for $t: source=$a restored=$b"
done
psql -Atd "$dst" -c "select nickname from assets" | grep -q "Line2" || fail "multi-line text did not survive"
psql -Atd "$dst" -c "select amount from observations" | grep -qx "12345.67" || fail "numeric precision lost"

# 6. safety checks
scripts/backup/restore.sh "$archive" "$tmp/key.txt" "dbname=$dst" >/dev/null 2>&1 && fail "restore into a non-empty database must be refused"
age-keygen -o "$tmp/wrong.txt" >/dev/null 2>&1
mkdb "$dst2"
scripts/backup/restore.sh "$archive" "$tmp/wrong.txt" "dbname=$dst2" >/dev/null 2>&1 && fail "wrong key must not decrypt"
echo "BACKUP SELFTEST PASSED"
