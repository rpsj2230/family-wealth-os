# Runbook — Daily backups and restore

## What you get

Every night at **02:30 Singapore time** the GitHub Action *Daily database backup*:

1. exports the whole database (schema, all data, and — when allowed — the login accounts);
2. **test-restores** the export into a scratch database (so a broken backup is caught the same night) and writes one spreadsheet-ready CSV per table;
3. **encrypts** everything with your public key (the private key never leaves you);
4. commits the encrypted archive to the **`backups` branch of this repository**.

Everything lives in one place: branch `backups`.

```
backups branch
├── latest/fwos-latest.tar.gz.age     ← the newest backup: restore from this
├── archive/YYYY/MM/…                 ← last 60 days + first backup of each of the last 12 months
├── restore.sh                        ← restore tool
├── index.json                        ← list with checksums (no financial data)
└── README.md
```

Because the files are encrypted with `age`, they are unreadable without your private key — even though the repository is private. The nightly job holds only the **public** key.

## One-time setup (about 5 minutes)

1. Install `age` on your computer: macOS `brew install age` · Windows `winget install FiloSottile.age` · Linux `sudo apt install age`.
2. Run `scripts/backup/make-key.sh` (or `age-keygen -o fwos-backup-key.txt`). It prints a line `Public key: age1…`.
3. GitHub → repo → **Settings → Secrets and variables → Actions → Variables → New repository variable**: name `BACKUP_AGE_PUBLIC_KEY`, value = the `age1…` line.
4. Save the **private key file** (`fwos-backup-key.txt`) in your password manager **and** share it with Ragini (shared vault entry). Without it no backup can be opened; with it anyone can read everything, so treat it like a master password. Add its location to the emergency page (P8).
5. The job also needs the secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` (see the setup runbook).
6. Run it once now: GitHub → **Actions → Daily database backup → Run workflow**. A green run creates the `backups` branch.

If the job cannot run (missing key/secret, Supabase paused, export fails) the workflow turns red and GitHub emails you. A red run is never silent.

## Restore

You need: the private key file, `age`, `psql`, a **new empty database that already has the schema**, and this repository checked out (for `supabase/migrations`).

### A. Into a fresh Supabase project

1. Create the new project (free plan). Apply the migrations: the *Apply database migrations* workflow after pointing the three secrets at the new project, or `supabase db push`.
2. Download `latest/fwos-latest.tar.gz.age` and `restore.sh` from the `backups` branch.
3. Run (use the database connection string from Supabase → *Connect*):
   ```bash
   ./restore.sh fwos-latest.tar.gz.age ~/fwos-backup-key.txt "postgresql://postgres:PASSWORD@HOST:5432/postgres" --with-auth
   ```
   `--with-auth` also restores the login accounts (so both of you can sign in with your old passwords). If it is omitted or the archive has no login data, create the two users in the dashboard and re-add them with `select add_household_member(...)`.
4. Update the Vercel environment variables to the new project's URL and keys, redeploy.

### B. Just read your data

Decrypt and open the CSV files — no database needed:
```bash
age -d -i ~/fwos-backup-key.txt fwos-latest.tar.gz.age | tar -xzf -
open fwos-backup/csv/        # one .csv per table, opens in Excel/Numbers
```

The restore refuses to run if the target database already contains data, and it verifies checksums of every file before loading.

## What is *not* in the database backup

- Uploaded source documents (statements, policy PDFs) kept in Supabase Storage — a separate storage export is planned (task P2.14b).
- Vercel settings and environment variables (keys are never stored in Git). Re-create from the setup runbook.

## How it is tested

`scripts/backup/selftest.sh` (run in CI on every push) builds a sample database, dumps it, verifies the restore, encrypts, restores into an empty database and compares row counts, and checks that the tool refuses: running without a key, restoring into a non-empty database, and decrypting with the wrong key.

## Restore drill

`scripts/restore-drill.sh` proves the chain end to end with **invented data and a throwaway key** (nothing real, no secrets):
it builds a database from the repo's migrations, fills it, dumps it as the nightly job does, encrypts it, restores it into an
empty database with the real `restore.sh`, and compares **every public table** (row count and a checksum of its full content).
It then damages and truncates a copy of the archive and checks that the restore refuses both and loads nothing.

- Run it by hand: `PGUSER=… scripts/restore-drill.sh` against any Postgres you can create databases on (the same setup as `supabase/tests/run.sh`).
- It also runs on the 5th of every month as the GitHub Action *Restore drill* (and on demand). A red run means a table no longer survives a backup and restore, usually after a migration added something the backup tooling does not handle.
- It checks the tooling, not your actual backup file. **Your real backup can only be opened with your private key** (kept in your password manager and with Ragini); nobody else, including this app's developer, can open it. To test your own copy, restore it into an empty scratch database as described above and look at a few rows.
