#!/usr/bin/env bash
# Package plaintext dump files into one encrypted archive.
#   package.sh <dump-dir> <out-dir>
# Needs: AGE_RECIPIENT (public key, "age1..."), tar, age, sha256sum.
# <dump-dir> must contain: data.sql (required), schema.sql (required); optional: auth_data.sql, csv/, tables.json
set -euo pipefail
dump="${1:?dump dir}"; out="${2:?out dir}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT (age public key) is required: refusing to write an unencrypted backup}"
[[ "$AGE_RECIPIENT" == age1* ]] || { echo "AGE_RECIPIENT does not look like an age public key" >&2; exit 1; }
[ -s "$dump/data.sql" ] && [ -s "$dump/schema.sql" ] || { echo "dump dir must contain non-empty data.sql and schema.sql" >&2; exit 1; }
mkdir -p "$out"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
mkdir "$stage/fwos-backup"
cp "$dump"/*.sql "$stage/fwos-backup/"
[ -d "$dump/csv" ] && cp -r "$dump/csv" "$stage/fwos-backup/csv"
cp "$(dirname "$0")/restore.sh" "$stage/fwos-backup/restore.sh"
migs="$(ls supabase/migrations/*.sql 2>/dev/null | xargs -n1 basename | paste -sd, -)"
tables='{}'; [ -f "$dump/tables.json" ] && tables="$(cat "$dump/tables.json")"
cat > "$stage/fwos-backup/manifest.json" <<JSON
{
  "created_utc": "$stamp",
  "git_commit": "${GITHUB_SHA:-unknown}",
  "migrations": "$migs",
  "auth_data_included": $([ -s "$dump/auth_data.sql" ] && echo true || echo false),
  "row_counts": $tables,
  "files": {
$(cd "$stage/fwos-backup" && find . -type f ! -name manifest.json | sort | while read -r f; do printf '    "%s": "%s",\n' "${f#./}" "$(sha256sum "$f" | cut -d' ' -f1)"; done | sed '$ s/,$//')
  }
}
JSON
file="$out/fwos-backup-$stamp.tar.gz.age"
tar -C "$stage" -czf - fwos-backup | age -r "$AGE_RECIPIENT" -o "$file"
echo "$file"
