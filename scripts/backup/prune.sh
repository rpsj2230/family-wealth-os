#!/usr/bin/env bash
# Keep the newest N daily archives plus the first archive of each of the last M months.
#   prune.sh <archive-dir> [daily=60] [monthly=12]
set -euo pipefail
dir="${1:?archive dir}"; daily="${2:-60}"; monthly="${3:-12}"
mapfile -t all < <(find "$dir" -name 'fwos-backup-*.tar.gz.age' | sort -r)
keep=()
for f in "${all[@]:0:$daily}"; do keep+=("$f"); done
declare -A seen
for f in $(printf '%s\n' "${all[@]}" | sort); do
  ym="$(basename "$f" | sed -E 's/fwos-backup-([0-9]{6}).*/\1/')"
  [ -z "${seen[$ym]:-}" ] && { seen[$ym]=1; keep+=("$f"); }
done
months=$(printf '%s\n' "${!seen[@]}" | sort -r | head -n "$monthly")
for f in "${all[@]}"; do
  ym="$(basename "$f" | sed -E 's/fwos-backup-([0-9]{6}).*/\1/')"
  k=0; for g in "${keep[@]}"; do [ "$g" = "$f" ] && k=1; done
  # a first-of-month copy only counts while its month is within the retention window
  if [ $k = 1 ] && ! printf '%s\n' "${all[@]:0:$daily}" | grep -qx "$f"; then echo "$months" | grep -qx "$ym" || k=0; fi
  [ $k = 1 ] || { echo "pruning $f"; rm -f "$f"; }
done
