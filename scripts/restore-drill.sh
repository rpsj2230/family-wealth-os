#!/usr/bin/env bash
# Restore drill: proves that a backup made the way the nightly job makes it can be restored, with every table intact.
# Builds a throwaway database from the repo's migrations, fills it with INVENTED data, dumps it, encrypts it with a
# throwaway age key, restores into a second empty database with the real restore tool, and compares every public table
# (row count and a checksum of the full content). Then it damages a copy of the archive and checks the restore refuses it.
#   PGHOST/PGUSER/PGPASSWORD must point at a Postgres server you can create databases on (as supabase/tests/run.sh).
# Uses no real data and no real key; prints no secrets. Exits non-zero on any mismatch.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"; cd "$root"
tmp="$(mktemp -d)"; src="fwos_drill_src_$$"; dst="fwos_drill_dst_$$"; bad="fwos_drill_bad_$$"
cleanup() {
  for d in "$src" "$dst" "$bad"; do psql -q -d postgres -c "drop database if exists $d" >/dev/null 2>&1 || true; done
  rm -rf "$tmp"   # includes the throwaway key
}
trap cleanup EXIT
fail() { echo "RESTORE DRILL FAILED: $*" >&2; exit 1; }
mkdb() {
  psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $1"
  psql -v ON_ERROR_STOP=1 -q -d "$1" -f supabase/tests/00_stub.sql >/dev/null
  for m in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$m" >/dev/null; done
}
# one line per public table: name, rows, checksum of the whole table's content
fingerprint() {
  local t
  for t in $(psql -Atd "$1" -c "select tablename from pg_tables where schemaname='public' order by 1"); do
    psql -Atd "$1" -c "select '$t', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text), '')) from public.\"$t\" x"
  done
}

echo "1. building a source database from the migrations"
mkdb "$src"
psql -v ON_ERROR_STOP=1 -q -d "$src" >/dev/null <<'SQL'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'drill@example.test');
insert into households (id, name) values ('11111111-1111-1111-1111-1111111111d1', 'Drill household');
insert into household_members values ('11111111-1111-1111-1111-1111111111d1', '00000000-0000-0000-0000-0000000000d1', 'admin');
insert into owners (id, household_id, display_name) values
  ('22222222-2222-2222-2222-2222222222d1', '11111111-1111-1111-1111-1111111111d1', 'Anil'),
  ('22222222-2222-2222-2222-2222222222d2', '11111111-1111-1111-1111-1111111111d1', 'Beena, "the second"');
insert into assets (id, household_id, type, owner_id, nickname) values
  ('33333333-3333-3333-3333-3333333333d1', '11111111-1111-1111-1111-1111111111d1', 'bank_account', '22222222-2222-2222-2222-2222222222d1', E'Savings\nnote'),
  ('33333333-3333-3333-3333-3333333333d2', '11111111-1111-1111-1111-1111111111d1', 'mutual_fund', '22222222-2222-2222-2222-2222222222d1', 'Sample Flexi Cap Fund'),
  ('33333333-3333-3333-3333-3333333333d3', '11111111-1111-1111-1111-1111111111d1', 'mutual_fund', '22222222-2222-2222-2222-2222222222d2', 'Sample Index Fund');
insert into observations (household_id, asset_id, kind, amount, as_of, source, confidence)
  select household_id, id, 'balance', 100000.55 + row_number() over (), date '2026-10-01', 'manual', 'manual_confirmed' from assets;
insert into mf_positions (asset_id, household_id, fund_name, invested, provenance)
  select id, household_id, nickname, 80000.25, 'workbook' from assets where type = 'mutual_fund';
insert into mf_transactions (household_id, asset_id, txn_on, kind, amount, units, nav, balance_units, source_ref) values
  ('11111111-1111-1111-1111-1111111111d1', '33333333-3333-3333-3333-3333333333d2', '2024-01-05', 'purchase', 50000.00, 500.0000, 100.0000, 500.0000, 'drill-1'),
  ('11111111-1111-1111-1111-1111111111d1', '33333333-3333-3333-3333-3333333333d2', '2024-02-05', 'sip', 10000.00, 90.9090, 110.0000, 590.9090, 'drill-2'),
  ('11111111-1111-1111-1111-1111111111d1', '33333333-3333-3333-3333-3333333333d3', '2025-03-05', 'purchase', 20000.00, 250.0000, 80.0000, 250.0000, 'drill-3');
insert into tds_refunds (household_id, owner_id, fy, kind, expected_gain, expected_tds, expected_refund) values
  ('11111111-1111-1111-1111-1111111111d1', '22222222-2222-2222-2222-2222222222d1', '2026-27', 'harvest', 125000, 16250, 16250),
  ('11111111-1111-1111-1111-1111111111d1', '22222222-2222-2222-2222-2222222222d1', '2026-27', 'interest', 150000, 46800, 46800);
insert into cas_imports (household_id, owner_id, source_ref, schemes, transactions, outcome)
  values ('11111111-1111-1111-1111-1111111111d1', '22222222-2222-2222-2222-2222222222d1', 'drill-statement', 2, 3, 'imported');
insert into tasks (household_id, title, due_on) values ('11111111-1111-1111-1111-1111111111d1', 'Drill task', '2026-11-01');
SQL
fingerprint "$src" > "$tmp/src.fp"
[ "$(awk -F'|' '$2>0' "$tmp/src.fp" | wc -l)" -ge 8 ] || fail "the source database has too few filled tables to prove anything"

echo "2. dumping it the way the nightly job does (schema, then public data)"
dump="$tmp/dump"; mkdir "$dump"
pg_dump -d "$src" --schema=public --schema-only --no-owner --no-privileges -f "$dump/schema.sql" 2>>"$tmp/pgdump.log"
pg_dump -d "$src" --schema=public --data-only --no-owner -f "$dump/data.sql" 2>>"$tmp/pgdump.log"  # circular-key warnings are harmless: the restore defers triggers

echo "3. encrypting with a throwaway key"
age-keygen -o "$tmp/key.txt" 2>"$tmp/keygen.log"
pub="$(grep -o 'age1[a-z0-9]*' "$tmp/keygen.log" | head -1)"
[ -n "$pub" ] || fail "could not make a throwaway key"
archive="$(AGE_RECIPIENT="$pub" scripts/backup/package.sh "$dump" "$tmp/out")"
[ -s "$archive" ] || fail "archive not created"
grep -q "Drill household" "$archive" && fail "the archive contains plaintext"

echo "4. restoring into an empty database with the real restore tool"
mkdb "$dst"
scripts/backup/restore.sh "$archive" "$tmp/key.txt" "dbname=$dst" >"$tmp/restore.log" 2>&1 || { sed 's/^/   /' "$tmp/restore.log" >&2; fail "restore failed"; }

echo "5. comparing every public table"
fingerprint "$dst" > "$tmp/dst.fp"
if ! diff "$tmp/src.fp" "$tmp/dst.fp" >"$tmp/diff.txt"; then cat "$tmp/diff.txt" >&2; fail "restored tables differ from the source"; fi
tables="$(wc -l < "$tmp/src.fp")"; filled="$(awk -F'|' '$2>0' "$tmp/src.fp" | wc -l)"
echo "   $tables tables compared ($filled with rows): row counts and content checksums are identical"

echo "6. a damaged archive must be refused"
mkdb "$bad"
cp "$archive" "$tmp/damaged.age"
size="$(stat -c %s "$tmp/damaged.age")"
printf '\xde\xad\xbe\xef' | dd of="$tmp/damaged.age" bs=1 seek=$((size / 2)) conv=notrunc 2>/dev/null
if scripts/backup/restore.sh "$tmp/damaged.age" "$tmp/key.txt" "dbname=$bad" >"$tmp/damaged.log" 2>&1; then fail "a damaged archive was accepted"; fi
head -c "$((size / 2))" "$archive" > "$tmp/truncated.age"
if scripts/backup/restore.sh "$tmp/truncated.age" "$tmp/key.txt" "dbname=$bad" >"$tmp/truncated.log" 2>&1; then fail "a truncated archive was accepted"; fi
[ "$(psql -Atd "$bad" -c 'select count(*) from public.households')" = "0" ] || fail "a refused restore still loaded data"
echo "   damaged and truncated archives were refused, and nothing was loaded"

echo "RESTORE DRILL PASSED"
