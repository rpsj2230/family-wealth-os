# Family Wealth OS — Master Build Plan (living document)

**Owner:** Rupash · **Repo:** `rpsj2230/family-wealth-os` · **Last updated:** 25 Oct 2026 · **Current phase:** P0 (setup) — app live on Vercel; waiting on GitHub secrets (U12/Part D) for migrations

> This file is updated at the end of every work session. Status of every task is recorded here; nothing is "done" until its acceptance tests pass in CI. See the [change log](#change-log) at the bottom.

**How to read this file:** every task is a checkbox. `- [x]` = done and tested. ⏳ = in progress. 🚧 = waiting on something (usually you). ⛔ = dropped/deferred. On GitHub you can tick boxes yourself by editing the file; I also mirror progress in the Claude task panel.

## 0. Scope and ground rules

- India rules for tax and products; **INR** is the reporting currency; S$ balances are held natively and converted for display.
- Four owners (Rupash, Ragini, Advika, Viraj); tax ledgers are per owner and never merged. Both spouses have full visibility.
- Zero recurring cost. Any paid dependency requires your written approval (see [cost register](phase1/04-cost-register.md)).
- Masked identifiers only (last 4). No secrets in Git. Workbook/CAS files never committed.
- Projections are labelled estimates. No calculation silently returns zero; failures return a status.
- A phase closes only when its acceptance tests pass. Each phase ends with a demo and an updated plan.

## 1. Architecture at a glance

```
apps/web         Next.js (App Router, TypeScript) — UI + route handlers          → Vercel Hobby
packages/core    Pure TypeScript finance engine (XIRR, accrual, lots, tax, forecast) — no I/O, 100% unit-tested
packages/db      Generated Supabase types, query helpers, seed/fixtures
packages/ingest  Email/statement/CAS parsers, importers (workbook, CSV/XLSX) — pure + fixtures
workers/         Scheduled jobs run by GitHub Actions (NAV, FX, email poll, digest, backup, keep-alive)
supabase/        SQL migrations, RLS policies, pgTAP tests
docs/            Plans, specs, runbooks
```

Tooling: pnpm workspaces · Vitest · Playwright (phone/tablet/desktop) · ESLint/Prettier · `decimal.js` for money · GitHub Actions CI.

## 2. Milestones (what you can stop doing in Excel, and when)

| Milestone | Phases | You can retire from the spreadsheet |
|---|---|---|
| **M1 — Spreadsheet replacement** | P0, P2 | Balances, net worth, monthly update, emergency registry (basic) |
| **M2 — Banks, FDs and funds** | P3, P4 | FDs, maturities, NAV-based fund values, XIRR |
| **M3 — Planning and reporting** | P6, P7, P8a | Goals, retirement view, daily/monthly email |
| **M4 — Tax and filing** | P5, P8b | Harvesting decisions, ITR working papers |
| **Go-live** | P9 | Production hardening, backup/restore drill |

## 3. Inputs needed from you (blocking items first)

- [x] **U1** Supabase project created (Mumbai); URL answers on `/auth/v1/health` (verified 25 Oct 2026). _Optional: connect the Supabase connector in claude.ai so I can apply migrations._
- [x] **U2** Vercel project connected and deployed from `main` — live at https://family-wealth-os-nine.vercel.app (`/api/health` → ok, Supabase reachable; verified 25 Oct 2026)
- [x] **U3** Push directly to `main` — approved by you
- [ ] **U4** ⏳ Answers to `phase1/05` Section A (A1, A3–A10; A2 resolved) _(needed by P2 import)_ _A2 done_
- [ ] **U5** Retirement inputs (B1–B8 in `phase1/05`) _(needed by P7)_
- [ ] **U6** CAS (CAMS + KFintech, all-time, detailed) for each PAN, or Kuvera transaction export _(needed by P4)_
- [ ] **U7** Gmail: create label `FWOS/Inbox` and a forwarding filter; sample bank emails (balance alerts, statements) with account numbers masked _(needed by P3)_
- [ ] **U8** Insurance/emergency register details (`phase1/05` Section C) _(needed by P8b)_
- [ ] **U9** Earlier monthly sheets (if any) _(needed by P2/P4)_
- [ ] **U10** SVG/high-res logo (optional) _(needed by P2)_
- [ ] **U12** 🚧 **Reset the Supabase database password** (it was pasted into chat on 25 Oct 2026, so treat it as exposed): Project Settings → Database → Reset password; put the new one only in the GitHub secret `SUPABASE_DB_PASSWORD` _(needed by P0.5)_
- [ ] **U11** Last 2–3 years of ITR, Form 26AS/AIS, TRC/Form 10F (for filing module fixtures) _(needed by P5)_

## 4. Phases and tasks

### P0 — Setup and environment  `[~]`

- [x] **P0.1** Repo created; Phase 1 docs, logo and `.gitignore` pushed
- [x] **P0.2** pnpm monorepo scaffold (`apps/web`, `packages/core`, `workers`, `supabase`) — `packages/db` and `packages/ingest` are created when first needed
- [x] **P0.3** TypeScript strict, Vitest, ESLint, Prettier, Playwright (phone/tablet/desktop) configured
- [x] **P0.4** GitHub Actions CI: lint, format check, typecheck, unit tests, build, database + RLS tests, backup self-test, browser tests
- [ ] **P0.5** 🚧 Supabase linked; `supabase/config.toml`; migrations pipeline applied from GitHub Actions _waiting on U12 + GitHub secrets (runbook Part D)_
- [x] **P0.6** Vercel connected to the repo; root `apps/web`, Next.js, Node 22, 'include files outside root' set; auto-deploy from `main`; `.env.example` ✅. _Follow-up: env vars currently exist for Production only — add Preview/Development before relying on preview deployments._
- [ ] **P0.7** Secrets inventory and rotation notes (`docs/runbooks/secrets.md`)
- [x] **P0.8** `/api/health` connectivity check (reports env presence and Supabase reachability; leaks nothing) and setup runbook `docs/runbooks/setup-vercel-supabase.md`
- [ ] **P0.9** Daily keep-alive job so the free Supabase project never pauses (needs a `ping` function from the first migration)

**Acceptance:** CI green; empty app deploys to a Vercel URL; migration pipeline runs against a clean database.

### P2 — Foundation (M1)  `[ ]`

- [x] **P2.1** Core + goals/receivables/policies migrations written and tested locally and in CI (**applies to Supabase once NEEDS A1 is done**)
- [x] **P2.2** Row Level Security tests (member sees household; outsider and emergency_viewer see nothing; append-only observations; tenant isolation via composite keys; import function) — mutation-checked
- [ ] **P2.3** ⏳ Login built (email + password, proxy-protected pages, sign-out, household bootstrap, add spouse); needs the two users from NEEDS A3 and the migration to be live
- [ ] **P2.4** Design system and app shell with RP logo; mobile-first nav; light/dark; accessibility baseline
- [ ] **P2.5** ⏳ `core`: money/units types (decimal), net-worth aggregation without double counting, freshness engine — **freshness engine done (6 tests)**; money types and aggregation pending
- [x] **P2.5b** **Current-balance engine** (`estimate.ts`): last verified balance + interest accrued (FD on contract terms, savings at account rate less TDS) + market change (units × NAV, or NAV ratio) + FX movement; every figure labelled calculated / estimated / carried-forward (11 tests)
- [ ] **P2.6** ⏳ Dashboard v1 built: net worth (estimated today vs last recorded), by person / liquidity / type, reliability table, attention list. Charts, freshness chips and per-account rate settings pending
- [ ] **P2.7** ⏳ **Monthly Update Mode built**: one grid for all accounts, inline edit, Excel column paste, keyboard navigation, validation, change summary, Save All (all-or-nothing, history kept); phone layout turns rows into cards. 10 unit tests + 7 SQL tests. Needs the live database for a hands-on trial
- [ ] **P2.8** **Review Queue**: stale, missing, unverified, unexplained-change items
- [ ] **P2.9** Import framework: batches, source documents, exceptions, dedupe keys, audit trail
- [ ] **P2.10** ⏳ Importer + in-app import page (upload → preview → reconcile → acknowledge → transactional commit, idempotent): **built; reproduces all 12 control totals of your real workbook**; awaiting live database
- [ ] **P2.11** ⏳ Daily snapshots stored (migration 4, tests) with 1M/3M/6M/1Y/3Y/5Y/All chart on the dashboard; recorded after every import, monthly save and dashboard visit. **Pending:** splitting a rise into new money vs growth (needs transactions from CAS), and a scheduled daily job
- [x] **P2.12** Tasks page: your old "Changes Req" items grouped by bank, add / done / drop / reopen (22 imported from your workbook)
- [ ] **P2.13** ⏳ Emergency guide v0 built (assets by institution with masked refs and last recorded values, policies, first-steps, nominee-vs-legal-heir note, print/PDF). Claim checklists, trusted contacts and delayed-release access come in P8
- [ ] **P2.14** ⏳ Nightly encrypted backup to the `backups` branch with test-restore, CSV copies, restore script and runbook — **built and self-tested; needs backup key (NEEDS A5) and Supabase token (A1) to run live**
- [ ] **P2.15** Data-export (CSV/XLSX) for every register
- [x] **P2.16** Per-account interest rate (and TDS) stored on the account and used by the current-balance estimate; editable in the Monthly grid
- [ ] **P2.17** ⏳ Fund values now move by NAV change since the recorded date, and S$ at the live rate, both labelled as estimates and never overwriting recorded values. Live once the daily job has run

**Acceptance (all automated unless noted):**
1. Importer reproduces FD principal ₹1,91,79,860, maturity value ₹2,34,08,127, SG cash ₹30,98,388 and each goal subtotal; difference ≥ ₹1 fails.
2. Matured RBL FDs are excluded from net worth and listed in the exceptions.
3. ULIP counted once; insurance coverage never in net worth; receivables not in "liquid".
4. RLS: second household cannot read any row; both spouses can.
5. Monthly grid: edit 20 rows, Save All writes one audit batch, history preserved.
6. Playwright passes at 390×844, 820×1180 and 1440×900.
7. Backup produced, decrypted and restored into a clean DB in CI.

### P3 — Banks, FDs and ingestion (M2)  `[ ]`

- [ ] **P3.1** ⏳ FD register page built (principal, value today, rate, maturity, days left, bank figure and variance check, status); renewal linkage UI pending
- [ ] **P3.2** ⏳ FD accrual engine (quarterly compounding), variance vs bank maturity, TDS-adjusted view for NRO — **accrual + variance function done (11 tests, 7 workbook FDs within 0.05%)**; DB integration and TDS view pending
- [ ] **P3.3** ⏳ Maturity calendar and next-90-days list built; email/WhatsApp alerts at 7/15/30/60/90 days arrive with P8
- [ ] **P3.4** FD maturity cashflow: configure proceeds destination (cash / new FD / other); no double count
- [x] **P3.5** DICGC position per bank, per depositor and capacity, on deposits plus accrued interest, bank balances included; assumptions stated (joint holders to confirm)
- [ ] **P3.6** Gmail ingestion worker (read-only, label-based) with per-message audit
- [ ] **P3.7** Parser framework + fixtures; **one parser per bank** written from your sample emails (Yes, IDFC, RBL, IndusInd, Equitas, ESAF, AU, Jana, HDFC, UOB, DBS)
- [ ] **P3.8** Statement uploads: CSV/XLSX/PDF, encrypted PDF with per-import password (never stored)
- [ ] **P3.9** Bank transaction import and reconciliation; ledger vs available balance; unexplained-change detection
- [ ] **P3.10** Manual-entry shortcuts for new FD, redemption, skipped SIP, balance

**Acceptance:** each parser passes its masked fixtures; duplicates rejected; effective date ≠ email-received date; unexplained increases never labelled salary/interest; accrual within 0.05% of bank maturity for all 33 workbook FDs; DICGC output matches a hand-computed sample.

### P4 — Mutual funds (M2)  `[ ]`

- [ ] **P4.1** ⏳ AMFI scheme list loaded daily into the database; fund-name matcher (Direct/Regular aware, handles renamed funds, NAV sanity check) with a confirm-each-match page. Mergers/renames mapping pending
- [ ] **P4.2** ⏳ Daily job (GitHub Actions) stores latest NAVs for held funds and back-fills history from 2018 on first sight; FX rates stored. **Needs secret A6 to run**
- [ ] **P4.3** CAS importer (CAMS/KFintech) via parser; Kuvera CSV importer as fallback
- [ ] **P4.4** Transaction ledger, folios, dedupe, gap detection, units reconciliation vs statement
- [ ] **P4.5** Lot engine (FIFO/specific), switches, IDCW, stamp duty handling, historical holdings reconstruction
- [ ] **P4.6** ⏳ **XIRR** (scheme, folio, owner, household, selected date, realised): Newton + bracketed fallback, explicit failure statuses — **core solver done (9 tests incl. Microsoft's published example 0.373362535, multiple-root detection)**; aggregation by scope pending
- [ ] **P4.7** SIP plans: expected vs actual, skipped SIP flag, changes history
- [ ] **P4.8** **Goal allocations** (percent/amount, many-to-many, no double count) incl. FD/cash allocations
- [ ] **P4.9** Performance charts: value vs invested, P/L, yearly, fund comparison, allocation, drawdown
- [ ] **P4.10** Opening-position migration from workbook → replaced by CAS ledger with a reconciliation diff

**Acceptance:** XIRR matches independently computed examples (spreadsheet XIRR and a Python reference) to 1e-6 including redemptions, switches and repurchases; consolidated XIRR is computed from pooled cash flows (never averaged); internal transfers excluded; historical values use historical units × historical NAV; goal totals never exceed holding value.

### P5 — Tax harvesting and filing (M4)  `[ ]`

- [ ] **P5.1** ⏳ Effective-dated rules table with sources and a verification flag; FY 2025-26 and 2026-27 equity-fund rates loaded from secondary sources (12-month holding, 20% / 12.5%, ₹1.25 L allowance, 4% cess) and shown as **not yet verified** in the app. Earlier years return "rules missing" instead of guessing. Debt funds (slab) pending
- [x] **P5.2** Per-taxpayer ledger: short/long gains, set-off (short-term loss against both, long-term loss only against long-term), brought-forward losses, allowance after set-off; mixing owners throws; two PANs each get their own allowance (tested)
- [ ] **P5.3** ⏳ Exit load applied per lot by purchase age (tested); per-scheme load rules come with the scheme master (P4)
- [x] **P5.4** NRI tax deducted at source estimated per transaction, with the refund expected from filing and the cash received now
- [x] **P5.5** Redemption simulator page (private `/tax` and public sample `/demo/tax`): by units or amount, FIFO slices, term, exit load, allowance before/after, extra tax, TDS, refund, net cash
- [ ] **P5.6** ⏳ Harvest suggestion built (largest FIFO long-term sale that fits the remaining allowance, with trade-offs and costs; never auto-trades). Automatic scanning of your real lots waits for the CAS ledger (P4)
- [ ] **P5.7** Reinvestment plan recording (separate from holdings); XIRR continuity across repurchase
- [ ] **P5.8** ⏳ **Filing module**: interest income schedule per owner/FY built (NRO taxable, NRE exempt, joint flagged; estimated TDS at a rate you supply; CSV download at `/tax/filing`). Capital-gains statement and Schedule 112A CSV wait for the CAS ledger (P4)
- [ ] **P5.9** Form 26AS/AIS/TIS import and TDS reconciliation; refund estimate
- [ ] **P5.10** ⏳ Filing pack: document checklist on `/tax/filing` done; combined XLSX/PDF pack, TRC/Form 10F expiry tracker and filing calendar pending (due dates must be verified, not assumed)

**Acceptance:** tax rules tested across at least two financial years; separate PAN exemptions and losses; exit-load edge cases (partial lots, SIP lots with different dates); capital-gains totals reconcile to CAS; filing CSV validates against the portal's template with a sample.

### P6 — Other assets and goals (M3)  `[ ]`

- [ ] **P6.1** SGD/INR: native balances, dated FX rates (free source), stale-rate flag, FX vs asset change split
- [x] **P6.2** Receivables page: outstanding = lent − repayments you record, overdue status and days, expected-back date; never counted as cash (add-loan form included)
- [ ] **P6.3** ⏳ Policies imported from your sheet (term, S$ and India health, ULIP) with renewal/expiry/nominee/document fields; renewal and expiry reminders appear in the daily summary 45 days ahead (and once passed); NPS pending
- [ ] **P6.4** Property: purchase price, valuation history, documents
- [ ] **P6.5** Third-party-held assets (holder ≠ beneficial owner)
- [x] **P6.6** Goals page: target in today's ₹ and date, cost inflation, earmarked holdings (percent shares, never double counted, 100% cap enforced in the database), projected funding vs inflated cost, shortfall in today's ₹ and the extra monthly amount that closes it
- [ ] **P6.7** Liabilities register

**Acceptance:** receivable balance equals lent − repaid; insurance never in net worth; goal funding never double counts.

### P7 — Forecasting and retirement (M3)  `[ ]`

- [x] **P7.1** Assumption sets (equity, FD/cash, locked, inflation, healthcare inflation, volatility) with conservative/base/optimistic presets, editable per household and savable
- [x] **P7.2** Month-by-month projection engine (accumulation → retirement) validated against closed-form annuity formulas; planning horizon follows the younger spouse
- [x] **P7.3** Current-pace forecast uses your actual active SIPs (read from the imported funds) plus extra investing, annual step-up
- [ ] **P7.4** ⏳ FD proceeds sit in the cash bucket and earn the stated FD/cash return (no renewal at today's rate); per-FD maturity events and reinvestment choices pending
- [ ] **P7.5** ⏳ Conservative/base/optimistic done; stress cases added to the what-ifs (equity −4 pts, inflation +3 pts, spending +20%, investing halved, retire 2 years earlier); a sequence-of-returns crash at retirement start and an interrupted-SIP timeline pending
- [x] **P7.6** Monte Carlo (2,000 seeded paths, log-normal equity, random inflation): success rate, percentile bands; reproducible
- [x] **P7.7** Required corpus found by search over a full cash-flow run (spending, healthcare inflation, pensions, one-off costs, legacy, tax rate); matches the closed form
- [ ] **P7.8** ⏳ Withdrawal order cash → equity → locked, tax rate, longevity and ruin age done; configurable order and withdrawal-rate sensitivity pending
- [x] **P7.9** **"Can I Retire Now?" built**: button on the dashboard and menu; status (meets / shortfall / insufficient data), projected vs needed corpus (today's and future ₹), surplus, earliest age, age comparison, 3 scenarios, change effects, range of outcomes, data-quality badge, interactive assumptions, save; public sample page; refuses a verdict when essential inputs are missing. 30 browser tests on phone/tablet/desktop
- [ ] **P7.10** ⏳ Levers built (+₹10k/25k/50k, 10% step-up, spend −10%, retire 2 yrs later, returns −2 pts, inflation +1 pt); pause/lump-sum/lose-income/education what-ifs pending
- [ ] **P7.11** Residency-transition model (return to India: NRE/NRO treatment)

**Acceptance:** closed-form checks (annuity/FV) agree to 1e-6; seeded Monte Carlo reproducible; view shows one of *meets the plan under selected assumptions / projected shortfall / insufficient data* and **refuses a verdict if essential inputs are missing**; real-vs-nominal values both shown; no verdict based solely on an assumed return.

### P8 — Reporting, notifications, emergency (M3 / M4)  `[ ]`

- [ ] **P8.1** ⏳ Digest builder built and tested (estimated net worth, change since last snapshot, by person, bank-balance freshness line "No new verified bank balance received", NAV/FX dates, attention list, retirement line). Daily-vs-weekly/monthly cadence pending
- [ ] **P8.2** ⏳ Email via your own Gmail (SMTP app password; free, no domain). Idempotent per day, 3 retries with backoff, delivery log; records only "handed to the mail server", never "delivered". Workflow runs 08:30 Singapore. **Needs secrets SMTP_USER and SMTP_APP_PASSWORD (NEEDS A8) and the switch in Settings**
- [x] **P8.3** WhatsApp: one-tap share of today's summary (opens WhatsApp with the text ready; you choose the contact). No unofficial bots
- [ ] **P8.4** Alerts: maturities, stale data, failed imports, overdue receivables, renewals
- [ ] **P8.5** **Emergency vault**: asset map, claim checklists per institution (nominee vs legal heir), document locations, trusted contacts
- [ ] **P8.6** Owner-configured **delayed-release access** (request → veto window → unlock)
- [ ] **P8.7** Monthly encrypted "family asset map" PDF stored outside the app + recovery guide

**Acceptance:** retries and duplicate prevention tested; emergency role cannot read non-emergency tables; veto window enforced; no hidden admin path.

### P9 — Validation and go-live  `[ ]`

- [ ] **P9.1** Full financial regression suite; independent recalculation of 20 sample numbers against Excel
- [ ] **P9.2** Migration reconciliation report signed off by you
- [ ] **P9.3** ⏳ Security review: content-security policy, HSTS and framing headers added and browser-tested; dependency audit now gates CI at high severity (nodemailer upgraded; one moderate advisory remains in the spreadsheet reader's `uuid`, which only affects uses we do not make). RLS tests exist; a full written review and secret rotation drill pending
- [ ] **P9.4** Mobile/tablet/desktop test pass; accessibility check
- [ ] **P9.5** Free-tier verification against live quotas; keep-alive and backup jobs observed for 7 days
- [ ] **P9.6** Production deploy; restore drill from backup; runbooks (deploy, rotate secrets, recover)
- [ ] **P9.7** ⏳ User guide written (`docs/USER-GUIDE.md`: monthly routine, tax, emergency, backups); screenshots and a printable emergency chapter pending

### P10 — After go-live  `[ ]`
Parser maintenance for changed bank formats, yearly tax-rule updates, new-FY filing templates, enhancements.

## 5. Delivery order and checkpoints

`P0 → P2 (M1 demo) → P3 + P4 (M2 demo) → P6 → P7 + P8a (M3 demo) → P5 + P8b (M4 demo) → P9`.
After each milestone I will: update this file, publish release notes, and list the exact manual steps (if any) you need to take.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Free Supabase project pauses after inactivity | Daily keep-alive job; weekly export; documented restore |
| GitHub Actions or provider free limits change | Verify at P0/P9; fallback jobs on Vercel cron; email via Gmail SMTP |
| Bank email formats change | Parser fixtures, parse-failure → Review Queue, manual entry always available |
| CAS parser breaks on format change | Kuvera CSV fallback; manual ledger entry |
| Tax rules change | Rules are data; verify each FY; warnings when a rule is older than the FY |
| Incomplete history makes XIRR misleading | Status `incomplete_history`, never a silent number |
| Sensitive data exposure | Masking, RLS, private storage, no secrets in Git, audit log |
| Scope creep | Each task has acceptance tests; new ideas enter the plan as dated change-log items |

## 7. Decisions log

| Date | Decision |
|---|---|
| 25 Oct 2026 | India-only rules, INR reporting; four owners; both spouses full access (you) |
| 25 Oct 2026 | Masked identifiers only; clubbing not modelled, `source_of_funds` field kept optional (you) |
| 25 Oct 2026 | Somesh ₹2,00,000 loan is **outstanding** (not received); expected return date 4 Jul 2026 is overdue (you) |
| 25 Oct 2026 | Repo `rpsj2230/family-wealth-os`; Vercel Hobby + Supabase Free; GitHub Actions as scheduler (pending verification) |
| 25 Oct 2026 | Phase 1 deliverables approved by you |
| 25 Oct 2026 | Push directly to `main` (you) |
| 25 Oct 2026 | **Current balance = last verified balance + accrued interest (FD/savings rates) + market gain/loss (MF/stocks) + FX**, shown beside the verified value and labelled as an estimate; verified data is never overwritten (you) |
| 25 Oct 2026 | Supabase project (Mumbai) created; Vercel project created (you) |

## Change log

| Date | Change |
|---|---|
| 25 Oct 2026 | Plan created. Phase 1 closed. Somesh loan finding corrected per your clarification. Repo attached; Phase 1 documents committed. |
| 25 Oct 2026 | Monorepo scaffolded (Next.js 16, React 19, TS 5.9, Vitest). First tested core modules: XIRR, FD accrual, freshness (26 tests passing). CI workflow added. |
| 25 Oct 2026 | Plan converted to checkboxes. Added current-balance engine (core, tested), `/api/health`, Vercel/Supabase runbook. Supabase reachable. DB password was shared in chat — reset requested (U12). |
| 25 Oct 2026 | Vercel connector approved; I set Root Directory `apps/web`, Node 22.x, redeployed from `main`. `/api/health` returns ok with Supabase reachable. App is live. |

## Added 26 Oct after your feedback (checklist)

- [x] **N1** Fund value now includes SIP instalments automatically: last recorded value moved by NAV, plus every SIP instalment due since then (debit day = day of the SIP start date), each valued at today's NAV; shown as its own "SIP instalments" figure; switchable; stopped SIPs excluded. Stays an estimate until a statement is imported
- [x] **N2** Database migrations applied to your Supabase project through the pooler with only the database password (no access token needed); backup job uses the same method
- [x] **N3** Bank-email reader: HDFC balance alert read by rule; statements and other formats by AI (Groq or Gemini key saved write-only in Settings); Gmail read over IMAP every 3 hours with the existing app password; verified-sender and single-account rules decide what is applied; everything else waits in the Inbox page. 59 tests. Needs: IMAP on in Gmail, GitHub secrets A8, more sample emails per bank
- [ ] **N4** CAS import (CAMS/KFintech PDFs, password = PAN) for you and Ragini; sync positions, lots, SIPs; needs sample PDFs
- [ ] **N5** ⏳ UI redesign: Tailwind v4 + shadcn-style components (Button, Card, Badge, Stat), sidebar with icons on desktop, floating bottom bar and "More" tiles on phone, gradient net-worth card, key-figure tiles, proportional bars, refreshed forms/tables/dark mode for every page; public preview at `/demo/dashboard`. Per-page polish of Monthly update, Deposits and Retire to follow
- [ ] **N6** Automatic tax-harvest advice from your lots, scheduled as tasks with reminders (email and WhatsApp share), before 31 March each year
- [ ] **N7** Forwarded Form 26AS / AIS reading for filing time
- [x] **N12** No hard-coded personal data or tunable numbers: people profiles (DOB, write-only PAN, residency, guardian, minors), income and spending, limits and reminders, tax rules per year, out-of-date days, harvest switches, dated tasks: all in Settings (see `docs/SETTINGS.md`); built-in execution plan removed from code; CI guard against private data
- [ ] **N13** Retirement assumptions panel moved into Settings (currently on the retirement page); salary and spending feed the plan automatically

