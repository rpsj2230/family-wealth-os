# Family Wealth OS — encrypted backups

This branch holds nightly, **encrypted** copies of the whole database. Nothing here can be read without your private key.

- `latest/fwos-latest.tar.gz.age` — the newest backup (this is the one to restore)
- `archive/YYYY/MM/` — the last 60 days plus the first backup of each of the last 12 months
- `restore.sh` — the restore tool
- `index.json` — list of archives with checksums

Restore in short (full guide: `docs/runbooks/backup-and-restore.md` on the main branch):

1. Install `age` and `psql`; have your private key file (the one you saved when setting up backups).
2. Create/prepare an empty database with the schema (apply `supabase/migrations` from the main branch).
3. `./restore.sh latest/fwos-latest.tar.gz.age /path/to/your-private-key.txt "postgresql://USER:PASSWORD@HOST:5432/postgres" --with-auth`

Each archive, once decrypted, contains `data.sql` (all data), `schema.sql`, `auth_data.sql` (logins, if exported), `csv/` (one spreadsheet-ready file per table), and `manifest.json` (checksums and row counts).
