#!/usr/bin/env bash
# Rebuild index.json (plain list of archives; contains no financial data) in the backups worktree.
set -euo pipefail
dir="${1:?backups worktree}"
cd "$dir"
{
  echo '{ "archives": ['
  find archive -name 'fwos-backup-*.tar.gz.age' | sort -r | while read -r f; do
    printf '    {"file": "%s", "bytes": %s, "sha256": "%s"},\n' "$f" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
  done | sed '$ s/,$//'
  echo '  ] }'
} > index.json
