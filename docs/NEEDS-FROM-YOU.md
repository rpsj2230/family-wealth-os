# What I still need from you (updated 27 Oct 2026)

Everything below is optional or one-time. The app runs without them; each item makes one part more exact.

**Already done, nothing for you to do:** database and all migrations applied; backups running (encrypted, `backups` branch); daily summary
email; bank-email reader; market data; CAS (fund statement) importer; automatic harvest plan, refund tracker (harvest and NRO interest),
rates page, "I need money" planner, family emergency handbook; repository private with a clean history.

1. **Request your fund statements (CAS) once, with your PAN as the password.** Ask CAMS/KFintech (or MF Central) for a *detailed* statement, **from the first investment to today**,
   for you and for Ragini, and forward the e-mails to your `FWOS/Inbox` label. They are opened with the PAN saved in Settings and imported by
   themselves (or upload the PDF under Import). A full history is what lets harvesting use your real purchase dates.
2. **Settings → People / Income / Tax refunds / When I need money / Emergency information**: fill in once, review the starting numbers.
3. **Import → choose the workbook → "Update order, names and links"** (upload the workbook once) so the screens keep your Excel order and notes.
4. **Settings → Rate pages and AI key**: add the bank rate-page URLs and a free Groq or Gemini key so rates and PDF statements are read automatically.
5. **Delete the old branch `claude/phase1-docs`** on GitHub (Branches page): it still holds the early history and I cannot delete it from here.
6. Optional: moving Supabase to Mumbai (needs a new project; say the word and I will script the move).
7. **Connect your Google Sheet (about ten minutes, free)** so *Sync with Google Sheet* can fill each month's tab: create a Google Cloud service account, enable the Google Sheets API, download its JSON key, share the sheet with the account's e-mail as **Editor**, then paste the sheet's link and the key in **Settings → Connections → Google Sheet** and press **Test connection**. Step by step: `docs/runbooks/google-sheet-sync.md`. The first real sync was only tested against a simulated Google, so read the **Preview** before confirming; a hidden `… - before sync` tab keeps the old data.

Form 26AS and the AIS: the reader is built (Tax filing papers; or e-mail the files to the inbox label). The department does not publish the
file layouts, so it reads what every version has and falls back to the AI reader; the first real file will show whether anything needs
adjusting. Fund statements: request them with **your PAN as the password** (the registrars let you choose it), see the User guide.

---
*The sheet below is the original questionnaire from October; almost all of it has been answered and applied.*

# Needs from you — review sheet

**Last updated:** 25 Oct 2026, late evening (Singapore) · Tick a box on GitHub (pencil icon → edit) when done, or just tell me in chat.
I keep working on everything that does not depend on these items. Anything below marked 🔴 blocks a specific part of the plan; the plan task it blocks is shown in brackets.

## A. Do first (about 10 minutes) — unlocks the database and login

- [ ] 🔴 **A1. Add the missing GitHub secret `SUPABASE_ACCESS_TOKEN`** [P0.5, P2.1]
  Supabase → avatar (bottom left) → *Account preferences* → *Access Tokens* → *Generate new token* (name `fwos-ci`). Copy it once, then GitHub → repo `family-wealth-os` → *Settings* → *Secrets and variables* → *Actions* → *New repository secret* → name `SUPABASE_ACCESS_TOKEN`.
  *My check on 25 Oct: the secrets `SUPABASE_DB_PASSWORD` and `SUPABASE_PROJECT_REF` already exist; only this one is missing.* As soon as it is added, my next push applies the database migration automatically (the "Apply database migrations" workflow retries on every push that touches `supabase/`). If you prefer, run it by hand: GitHub → *Actions* → *Apply database migrations* → *Run workflow*.
- [ ] 🔴 **A2. Reset the Supabase database password** (it was shared in chat) [security]
  Supabase → *Project Settings* → *Database* → *Reset database password*. **Then update the GitHub secret `SUPABASE_DB_PASSWORD` to the new value**, otherwise the migration job will fail to connect. Never paste it in chat.
- [ ] **A3. Create your two logins** [P2.3]
  Supabase → *Authentication* → *Users* → *Add user* → *Create new user* (tick *Auto Confirm User*) for yourself and for Ragini, with strong unique passwords. Then *Authentication* → *Sign In / Providers* → turn **off** "Allow new users to sign up". Also *Authentication* → *URL Configuration*: Site URL `https://family-wealth-os-nine.vercel.app`, add redirect `https://family-wealth-os-nine.vercel.app/**` and `http://localhost:3000/**`.
- [ ] **A4. Vercel: add the two public variables to Preview and Development** [P0.6 follow-up]
  Project → *Settings* → *Environment Variables*: for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` tick Preview and Development as well. (Optional until you use preview deployments.)

- [ ] 🔴 **A5. Set up the backup key** (5 minutes; full steps in `docs/runbooks/backup-and-restore.md`) [P2.14 — the nightly backup stays red until this is done]
  Install `age` (`brew install age`), run `age-keygen -o fwos-backup-key.txt`, put the `age1…` public key into GitHub → Settings → Secrets and variables → Actions → **Variables** → `BACKUP_AGE_PUBLIC_KEY`. Keep the private key file in your password manager **and** share it with Ragini. Then run *Actions → Daily database backup → Run workflow* once to confirm it is green. (It also needs A1.)

- [ ] 🔴 **A6. Add the GitHub secret `SUPABASE_SERVICE_ROLE_KEY`** (the Supabase *Secret key*; same value you put in Vercel) [market data, backups]
  GitHub → Settings → Secrets and variables → Actions → New repository secret. Then run *Actions → Refresh market data → Run workflow*. This loads the official fund list, today's NAVs for your funds and the S$ rate. Afterwards open **More → Match funds** in the app and confirm each fund's official scheme (about 5 minutes). Once confirmed, your fund values move with the market (labelled as estimates).
- [ ] **A7. Look at the sample pages (no login needed):** `/demo/retire` (Can I retire now?) and `/demo/tax` (redemption and harvest simulator) on your Vercel address, e.g. https://family-wealth-os-nine.vercel.app/demo/retire

- [ ] **A8. Daily summary email setup** [P8.2] (optional but recommended)
  1. Use a Gmail account for sending (yours is fine). Turn on 2-Step Verification, then create an **App password** (Google Account → Security → App passwords). 2. In GitHub add two secrets: `SMTP_USER` (the Gmail address) and `SMTP_APP_PASSWORD` (the 16-character app password; never paste it in chat). 3. In the app: **More → Settings and daily summary**, tick *Send the daily summary*, add extra recipients if you want. 4. Test: GitHub → Actions → *Daily summary email* → Run workflow. You should get the email within a minute; the app's delivery log shows "Handed to the mail server".

## B. Answers I need for the data migration (from `docs/phase1/05-open-questions-and-missing-fields.md`)

- [ ] 🔴 **B1.** The two **RBL FDs** (₹5 L each, Rupash and Ragini) that matured on 23 Sep 2026: renewed into the 8 Sep 2026 RBL FDs, credited to another account, or still pending? [P2.10 — until you answer they stay excluded from net worth]
- [ ] **B2.** What does **`JO`** mean (joint with whom, in what order) for each joint account? [DICGC calculation, P3.5]
- [ ] **B3.** **Advika and Viraj**: do they have PANs? Are their accounts minor accounts operated by you or Ragini? [owner model]
- [ ] **B4.** Which **date** does each balance in the workbook represent? (I will assume 25 Oct 2026 unless you say otherwise.)
- [ ] **B5.** The five funds with start date "4 Jan 2026": is that 4 January, 1 April, or something else? [F10]
- [ ] **B6.** What does **`today`** in column J mean on four stopped funds? [F11]
- [ ] **B7.** Two Jana FDs (Rupash; booked 26 Oct 2025 and 8 Sep 2026) show the **same FD number** — which is correct? [F12]
- [ ] **B8.** The **₹50,000 "Haar Me"** loan to Somesh: current status? Any interest or a new expected date for the ₹2,00,000?
- [ ] **B9.** Do **earlier monthly sheets** exist? If yes, please share them (history for charts).

## C. Retirement and goals inputs [P7 — until then "Can I Retire Now?" will show "insufficient data"]

- [ ] 🔴 **C1.** Current monthly household spending (India and Singapore, if separate).
- [ ] 🔴 **C2.** Expected monthly spending after retiring in India, in today's rupees.
- [ ] 🔴 **C3.** Monthly income (both of you) and how long it is expected to continue. Is the sheet's **"Ideal ₹2.64 L/month" saving** your real target?
- [ ] **C4.** Planning age for Ragini (default 95).
- [ ] **C5.** One-off future costs: education (India or overseas, year, cost in today's rupees) for Advika and Viraj, marriages, home, vehicle.
- [ ] **C6.** Bhopal flat: any loan? Will it be your retirement home, rented, or sold? Current value.
- [ ] **C7.** Do you plan to move back to India **before** age 60 (and when)? It changes NRE/NRO treatment.
- [ ] **C8.** Which goals should the FDs and cash fund? (₹1.92 Cr of FDs currently has no goal.)
- [ ] **C9.** Savings-account interest rates and any TDS rate per account (for the "current balance" estimate). Defaults I will use meanwhile: 3% savings, 0% TDS on NRE, 0% shown for NRO until you confirm.

## D. Documents and access I need later (not blocking tonight)

- [ ] **D1.** Consolidated **CAS** (CAMS + KFintech, all-time, detailed) for each PAN, or a Kuvera transaction export. [P4]
- [ ] **D2.** **Sample bank emails** (balance alerts, statements) with account numbers masked, for each bank. Create the Gmail label `FWOS/Inbox` and a forwarding filter. [P3]
- [ ] **D3.** **ITR, Form 26AS/AIS and TRC/Form 10F** for the last 2–3 years (masked PANs are fine for test fixtures). [P5]
- [ ] **D4.** **Insurance and emergency details**: HDFC Life term (expiry age, nominee), Great Eastern and Niva Bupa renewal dates, AIA (employer) end conditions, ULIP withdrawal terms, NPS (confirm none), trusted contacts, will location, nominee details per account. [P8]
- [ ] **D5.** SVG or high-resolution RP logo (optional).
- [ ] **D6.** Connect the **Supabase connector** in claude.ai (optional; lets me apply database changes without the GitHub token).

## E. Decisions I made on your behalf (please skim; tell me to change any)

1. Pushed straight to `main` (your permission). Every push runs tests; the production site redeploys automatically.
2. Vercel project: Root Directory `apps/web`, Node 22, Next.js. Production-only environment variables for now (see A4).
3. Database design follows the approved Phase 1 proposal with these specifics: observations are **append-only** (a correction is a new row), full members are `admin` or `member`, and `emergency_viewer` can never read financial tables; identifiers are masked (last 4 only); every change is audit-logged.
4. The daily keep-alive job (10:17 Singapore time) uses your public Supabase URL and publishable key, which are public by design.
5. Current-balance estimates use the rules in the plan (decision log, 25 Oct): FDs on contract terms; savings at an assumed rate; funds by NAV; S$ by FX; everything labelled calculated / estimated / carried-forward.
6. I will import your workbook **inside the app** (upload → preview report → confirm) using your own login, so no key ever needs to leave Vercel.

## F. What happened overnight (newest first)

- 26 Oct (day): **Database migrations applied** (7 of 7) to your Supabase project through the connection pooler using only the database password (the access-token secret was empty in GitHub, so the job no longer needs it). Note: your Supabase project is in **Sydney**, not Mumbai (data residency is not an issue for this app, but you should know). Fund values now add **SIP instalments automatically**. **Bank-email reader** built (HDFC alert format from your screenshot): see settings for the AI key. CAS PDFs did not arrive in the session; see D1.

- 26 Oct: security headers (content policy, HSTS) added and browser-tested; a dependency vulnerability scan now blocks a release on high-severity findings; mail library upgraded. Add-loan form and policy renewal reminders (daily summary, 45 days ahead) done. Short **user guide** written: `docs/USER-GUIDE.md`.

- 26 Oct: **Tax filing papers** built at `/tax/filing`: FD interest per person and year (NRO taxable, NRE exempt, joint accounts flagged), optional tax-at-source estimate at a rate you type, CSV download, filing checklist. Capital-gains parts wait for D1; the checks against Form 26AS wait for D3. Due dates are deliberately not hard-coded (verify on the Income Tax site).

- 26 Oct: market data (AMFI scheme list, NAVs, S$ rate) pipeline, fund-to-scheme matcher and NAV-based estimates built; tax engine and simulator built. **Observation:** your sheet converts S$ at ₹65, but the market rate on 23 Oct 2026 was about ₹74.26 per S$. At that rate your S$47,667.51 is about ₹35.4 lakh, not ₹30.98 lakh (about ₹4.4 lakh more). The app will use the live rate once the market-data job has run and will show the currency effect separately.

- 26 Oct: **"Can I Retire Now?" is built** (menu + dashboard button) and tested; try the public sample at /demo/retire. Monthly Update grid, daily snapshots with history chart, in-app workbook import, nightly encrypted backup, database migrations 1–5 (all tested) are written. Nothing live until A1 (migrations) and A3 (logins) are done.

- 26 Oct: nightly **encrypted backup** to the `backups` branch built and self-tested (restore, wrong-key and non-empty-target refusals all pass); lint, formatting and phone/tablet/desktop browser tests added to CI; Vercel told not to build the `backups` branch.

- 25 Oct, evening: Vercel live and verified; database schema v1 + row-level-security tests written and passing in CI (migration not yet applied to Supabase — waiting on A1).
