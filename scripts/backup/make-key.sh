#!/usr/bin/env bash
# One-time: create the key pair used to encrypt backups. Run on YOUR computer (not in CI).
#   macOS:  brew install age      Windows: winget install FiloSottile.age      Linux: apt install age
set -euo pipefail
out="${1:-fwos-backup-key.txt}"
[ -e "$out" ] && { echo "$out already exists; refusing to overwrite." >&2; exit 1; }
age-keygen -o "$out"
chmod 600 "$out"
cat <<MSG

1. The line that starts with "Public key: age1..." above is NOT secret. Put it in GitHub:
   repo > Settings > Secrets and variables > Actions > Variables > New repository variable
   Name: BACKUP_AGE_PUBLIC_KEY      Value: age1...
2. The file "$out" is the PRIVATE key. Without it no backup can ever be opened.
   Store copies in your password manager AND give Ragini access (e.g. shared vault entry). Never commit it.
MSG
