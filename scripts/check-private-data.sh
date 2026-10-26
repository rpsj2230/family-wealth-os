#!/usr/bin/env bash
# Fails when files tracked by git contain things that must live in Settings or the database, never in code:
#   - a PAN-shaped value (ABCDE1234F), except the documented placeholder
#   - an email address on a real mail provider
# Test fixtures use invented values (example.test, ABCDE1234F). Run by CI; run it yourself before pushing.
set -uo pipefail
cd "$(dirname "$0")/.."
files=$(git ls-files | grep -vE '(\.png|\.webp|\.jpg|pnpm-lock\.yaml|\.age)$')
bad=0
pan=$(echo "$files" | xargs grep -nE '\b[A-Z]{5}[0-9]{4}[A-Z]\b' 2>/dev/null | grep -v 'ABCDE1234F' | grep -v 'scripts/check-private-data.sh' || true)
if [ -n "$pan" ]; then echo "PAN-shaped value found:"; echo "$pan"; bad=1; fi
mail=$(echo "$files" | xargs grep -nEi '[a-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|icloud|proton)\.(com|me)' 2>/dev/null | grep -vE 'someone@gmail.com|scripts/check-private-data.sh' || true)
if [ -n "$mail" ]; then echo "Personal email address found:"; echo "$mail"; bad=1; fi
[ "$bad" = 0 ] && echo "No private data patterns found."
exit "$bad"
