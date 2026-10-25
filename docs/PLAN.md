# Family Wealth OS — Master Build Plan (living document)

**Owner:** Rupash · **Repo:** `rpsj2230/family-wealth-os` · **Last updated:** 25 Oct 2026 · **Current phase:** P0 (setup) — core engine started

> This file is updated at the end of every work session. Status of every task is recorded here; nothing is "done" until its acceptance tests pass in CI. See the [change log](#change-log) at the bottom.

**Status key:** `[ ]` not started · `[~]` in progress · `[x]` done and tested · `[!]` blocked · `[-]` dropped/deferred

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

| ID | Item | Needed by | Status |
|---|---|---|---|
| U1 | Create a **Supabase** project (Free plan, region Singapore or Mumbai) and share only the project reference. Keys go straight into Vercel/GitHub secrets, never in chat. Optional: connect the Supabase connector in claude.ai so I can apply migrations. | P0 | `[ ]` |
| U2 | **Vercel**: import `rpsj2230/family-wealth-os` (framework: Next.js, root `apps/web`). Add env vars from Supabase. | P0 | `[ ]` |
| U3 | Decide: may I push directly to `main`, or should I use branches and you merge? | P0 | `[ ]` |
| U4 | Answers to `phase1/05` Section A (A1, A3–A10; A2 resolved) | P2 import | `[~]` A2 done |
| U5 | Retirement inputs (B1–B8 in `phase1/05`) | P7 | `[ ]` |
| U6 | CAS (CAMS + KFintech, all-time, detailed) for each PAN, or Kuvera transaction export | P4 | `[ ]` |
| U7 | Gmail: create label `FWOS/Inbox` and a forwarding filter; sample bank emails (balance alerts, statements) with account numbers masked | P3 | `[ ]` |
| U8 | Insurance/emergency register details (`phase1/05` Section C) | P8b | `[ ]` |
| U9 | Earlier monthly sheets (if any) | P2/P4 | `[ ]` |
| U10 | SVG/high-res logo (optional) | P2 | `[ ]` |
| U11 | Last 2–3 years of ITR, Form 26AS/AIS, TRC/Form 10F (for filing module fixtures) | P5 | `[ ]` |

## 4. Phases and tasks

### P0 — Setup and environment  `[~]`

| ID | Task | Status |
|---|---|---|
| P0.1 | Repo created; Phase 1 docs, logo and `.gitignore` pushed | `[x]` |
| P0.2 | pnpm monorepo scaffold (`apps/web`, `packages/core`, `workers`, `supabase`) — `packages/db` and `packages/ingest` are created when first needed | `[x]` |
| P0.3 | TypeScript strict ✅, Vitest ✅; ESLint, Prettier scripts and Playwright config still to add | `[~]` |
| P0.4 | GitHub Actions CI (typecheck, test, build on every push) written; **lint step pending ESLint**; first run to be confirmed green | `[~]` |
| P0.5 | Supabase project linked; `supabase/config.toml`; migrations pipeline (CI applies to a shadow DB) | `[!]` U1 |
| P0.6 | Vercel project connected; preview deployments; env-var template `.env.example` | `[!]` U2 |
| P0.7 | Secrets inventory and rotation notes (`docs/runbooks/secrets.md`) | `[ ]` |

**Acceptance:** CI green; empty app deploys to a Vercel URL; migration pipeline runs against a clean database.

### P2 — Foundation (M1)  `[ ]`

| ID | Task | Status |
|---|---|---|
| P2.1 | Core migrations v1: households, members, owners, institutions, assets, accounts, observations, snapshots, tasks, audit_events | `[ ]` |
| P2.2 | RLS policies + pgTAP tests (member sees household; non-member sees nothing; tax tables single-owner) | `[ ]` |
| P2.3 | Authentication: email + password with email verification, optional TOTP; two users; session hardening | `[ ]` |
| P2.4 | Design system and app shell with RP logo; mobile-first nav; light/dark; accessibility baseline | `[ ]` |
| P2.5 | `core`: money/units types (decimal), net-worth aggregation without double counting, freshness engine — **freshness engine done (6 tests)**; money types and aggregation pending | `[~]` |
| P2.6 | Dashboard v1: household / per-owner net worth, liquid / investable / illiquid views, freshness chips | `[ ]` |
| P2.7 | **Monthly Update Mode**: spreadsheet-style grid, inline edit, paste, keyboard nav, validation, Save All, change summary | `[ ]` |
| P2.8 | **Review Queue**: stale, missing, unverified, unexplained-change items | `[ ]` |
| P2.9 | Import framework: batches, source documents, exceptions, dedupe keys, audit trail | `[ ]` |
| P2.10 | **Workbook importer** with dry-run → reconciliation report → commit (rules in doc 02) | `[ ]` |
| P2.11 | Historical snapshots and range charts (1M…All) separating contributions / valuation / transfers | `[ ]` |
| P2.12 | Tasks module (address/KYC/maturity-instruction items from column M) | `[ ]` |
| P2.13 | Emergency registry v0 (institutions, masked refs, owners, document locations) | `[ ]` |
| P2.14 | Scheduled encrypted export (backup) to a location you control + restore script | `[ ]` |
| P2.15 | Data-export (CSV/XLSX) for every register | `[ ]` |

**Acceptance (all automated unless noted):**
1. Importer reproduces FD principal ₹1,91,79,860, maturity value ₹2,34,08,127, SG cash ₹30,98,388 and each goal subtotal; difference ≥ ₹1 fails.
2. Matured RBL FDs are excluded from net worth and listed in the exceptions.
3. ULIP counted once; insurance coverage never in net worth; receivables not in "liquid".
4. RLS: second household cannot read any row; both spouses can.
5. Monthly grid: edit 20 rows, Save All writes one audit batch, history preserved.
6. Playwright passes at 390×844, 820×1180 and 1440×900.
7. Backup produced, decrypted and restored into a clean DB in CI.

### P3 — Banks, FDs and ingestion (M2)  `[ ]`

| ID | Task | Status |
|---|---|---|
| P3.1 | FD register UI; renewal linkage; status model (active/matured/renewed/closed/unconfirmed) | `[ ]` |
| P3.2 | FD accrual engine (quarterly compounding), variance vs bank maturity, TDS-adjusted view for NRO — **accrual + variance function done (11 tests, 7 workbook FDs within 0.05%)**; DB integration and TDS view pending | `[~]` |
| P3.3 | Maturity calendar and alerts at 7/15/30/60/90 days; maturity-instruction tracker | `[ ]` |
| P3.4 | FD maturity cashflow: configure proceeds destination (cash / new FD / other); no double count | `[ ]` |
| P3.5 | DICGC calculator: per bank, per depositor capacity, principal + accrued interest; concentration report | `[ ]` |
| P3.6 | Gmail ingestion worker (read-only, label-based) with per-message audit | `[ ]` |
| P3.7 | Parser framework + fixtures; **one parser per bank** written from your sample emails (Yes, IDFC, RBL, IndusInd, Equitas, ESAF, AU, Jana, HDFC, UOB, DBS) | `[ ]` |
| P3.8 | Statement uploads: CSV/XLSX/PDF, encrypted PDF with per-import password (never stored) | `[ ]` |
| P3.9 | Bank transaction import and reconciliation; ledger vs available balance; unexplained-change detection | `[ ]` |
| P3.10 | Manual-entry shortcuts for new FD, redemption, skipped SIP, balance | `[ ]` |

**Acceptance:** each parser passes its masked fixtures; duplicates rejected; effective date ≠ email-received date; unexplained increases never labelled salary/interest; accrual within 0.05% of bank maturity for all 33 workbook FDs; DICGC output matches a hand-computed sample.

### P4 — Mutual funds (M2)  `[ ]`

| ID | Task | Status |
|---|---|---|
| P4.1 | Scheme master from AMFI (code, ISIN, plan, option, category), merger/rename mapping | `[ ]` |
| P4.2 | NAV loader (daily) + history backfill for held schemes only; freshness and source dates | `[ ]` |
| P4.3 | CAS importer (CAMS/KFintech) via parser; Kuvera CSV importer as fallback | `[ ]` |
| P4.4 | Transaction ledger, folios, dedupe, gap detection, units reconciliation vs statement | `[ ]` |
| P4.5 | Lot engine (FIFO/specific), switches, IDCW, stamp duty handling, historical holdings reconstruction | `[ ]` |
| P4.6 | **XIRR** (scheme, folio, owner, household, selected date, realised): Newton + bracketed fallback, explicit failure statuses — **core solver done (9 tests incl. Microsoft's published example 0.373362535, multiple-root detection)**; aggregation by scope pending | `[~]` |
| P4.7 | SIP plans: expected vs actual, skipped SIP flag, changes history | `[ ]` |
| P4.8 | **Goal allocations** (percent/amount, many-to-many, no double count) incl. FD/cash allocations | `[ ]` |
| P4.9 | Performance charts: value vs invested, P/L, yearly, fund comparison, allocation, drawdown | `[ ]` |
| P4.10 | Opening-position migration from workbook → replaced by CAS ledger with a reconciliation diff | `[ ]` |

**Acceptance:** XIRR matches independently computed examples (spreadsheet XIRR and a Python reference) to 1e-6 including redemptions, switches and repurchases; consolidated XIRR is computed from pooled cash flows (never averaged); internal transfers excluded; historical values use historical units × historical NAV; goal totals never exceed holding value.

### P5 — Tax harvesting and filing (M4)  `[ ]`

| ID | Task | Status |
|---|---|---|
| P5.1 | Effective-dated `tax_rules` for each FY (rates, exemption, holding periods, grandfathering, TDS) — verified against the current Finance Act before use | `[ ]` |
| P5.2 | Per-owner tax ledgers: STCG/LTCG, losses, carry-forward, exemption usage; cross-owner joins impossible | `[ ]` |
| P5.3 | Exit-load rules per scheme; lot-level eligibility dates | `[ ]` |
| P5.4 | NRI TDS modelling on redemptions; **net benefit including TDS and refund timing** | `[ ]` |
| P5.5 | Harvest simulator (select lot/units/amount), before/after, compare "sell now vs wait" | `[ ]` |
| P5.6 | Recommendation engine with explanations and trade-offs; never auto-executes | `[ ]` |
| P5.7 | Reinvestment plan recording (separate from holdings); XIRR continuity across repurchase | `[ ]` |
| P5.8 | **Filing module**: capital-gains statement per PAN/FY; Schedule 112A upload CSV (verify current template); interest income schedule (NRO FDs); TDS entries | `[ ]` |
| P5.9 | Form 26AS/AIS/TIS import and TDS reconciliation; refund estimate | `[ ]` |
| P5.10 | Filing pack (XLSX/CSV/PDF) per owner/FY; document checklist; TRC/Form 10F expiry tracker; filing calendar | `[ ]` |

**Acceptance:** tax rules tested across at least two financial years; separate PAN exemptions and losses; exit-load edge cases (partial lots, SIP lots with different dates); capital-gains totals reconcile to CAS; filing CSV validates against the portal's template with a sample.

### P6 — Other assets and goals (M3)  `[ ]`

| ID | Task | Status |
|---|---|---|
| P6.1 | SGD/INR: native balances, dated FX rates (free source), stale-rate flag, FX vs asset change split | `[ ]` |
| P6.2 | Receivables: lending, repayments, overdue status/reminders, interest terms | `[ ]` |
| P6.3 | Policies register: term, health (SG employer / SG private / India), ULIP, pension, NPS; renewals and expiry | `[ ]` |
| P6.4 | Property: purchase price, valuation history, documents | `[ ]` |
| P6.5 | Third-party-held assets (holder ≠ beneficial owner) | `[ ]` |
| P6.6 | Goals: target, date, inflation, funding progress, gap, required contribution; India vs overseas education | `[ ]` |
| P6.7 | Liabilities register | `[ ]` |

**Acceptance:** receivable balance equals lent − repaid; insurance never in net worth; goal funding never double counts.

### P7 — Forecasting and retirement (M3)  `[ ]`

| ID | Task | Status |
|---|---|---|
| P7.1 | Assumption sets by asset class (equity, debt, FD, cash, pension, property) and inflation by category | `[ ]` |
| P7.2 | Deterministic projection engine (1–30 years, ages 40–65, custom) with per-owner and per-asset-class output | `[ ]` |
| P7.3 | Current-pace forecast from configured SIPs, annual step-ups, pauses, one-offs | `[ ]` |
| P7.4 | FD maturity events in cashflow projections; no auto-renewal at old rate | `[ ]` |
| P7.5 | Scenario engine: conservative / base / optimistic / downturn / high inflation / reduced income / interrupted SIPs / early / delayed | `[ ]` |
| P7.6 | Monte Carlo (web worker, seeded, reproducible) with success probability and percentile bands | `[ ]` |
| P7.7 | Retirement corpus requirement from time-based cash flows (spending, inflation, healthcare, reserve, one-offs, minimum legacy) | `[ ]` |
| P7.8 | Withdrawal planner: sequence, taxes, lock-ins, longevity, sensitivity to withdrawal rate | `[ ]` |
| P7.9 | **"Can I Retire Now?"** view: projected vs required corpus, earliest viable age (bisection), levers with impact, data-quality/confidence badges, interactive controls | `[ ]` |
| P7.10 | What-if library (SIP +5/10/15%, +₹10k/25k/50k, pause, lump sum, −2 pts return, lose an income, education up) | `[ ]` |
| P7.11 | Residency-transition model (return to India: NRE/NRO treatment) | `[ ]` |

**Acceptance:** closed-form checks (annuity/FV) agree to 1e-6; seeded Monte Carlo reproducible; view shows one of *meets the plan under selected assumptions / projected shortfall / insufficient data* and **refuses a verdict if essential inputs are missing**; real-vs-nominal values both shown; no verdict based solely on an assumed return.

### P8 — Reporting, notifications, emergency (M3 / M4)  `[ ]`

| ID | Task | Status |
|---|---|---|
| P8.1 | Digest generator (daily when changed, weekly, monthly full), timezone Asia/Singapore | `[ ]` |
| P8.2 | Email delivery (Resend, with Gmail SMTP fallback), idempotent sends, retries, delivery log; "delivered" only on provider confirmation | `[ ]` |
| P8.3 | WhatsApp share link and copyable summary; no unofficial bots | `[ ]` |
| P8.4 | Alerts: maturities, stale data, failed imports, overdue receivables, renewals | `[ ]` |
| P8.5 | **Emergency vault**: asset map, claim checklists per institution (nominee vs legal heir), document locations, trusted contacts | `[ ]` |
| P8.6 | Owner-configured **delayed-release access** (request → veto window → unlock) | `[ ]` |
| P8.7 | Monthly encrypted "family asset map" PDF stored outside the app + recovery guide | `[ ]` |

**Acceptance:** retries and duplicate prevention tested; emergency role cannot read non-emergency tables; veto window enforced; no hidden admin path.

### P9 — Validation and go-live  `[ ]`

| ID | Task | Status |
|---|---|---|
| P9.1 | Full financial regression suite; independent recalculation of 20 sample numbers against Excel | `[ ]` |
| P9.2 | Migration reconciliation report signed off by you | `[ ]` |
| P9.3 | Security review (RLS, secrets, storage, headers, dependency audit) | `[ ]` |
| P9.4 | Mobile/tablet/desktop test pass; accessibility check | `[ ]` |
| P9.5 | Free-tier verification against live quotas; keep-alive and backup jobs observed for 7 days | `[ ]` |
| P9.6 | Production deploy; restore drill from backup; runbooks (deploy, rotate secrets, recover) | `[ ]` |
| P9.7 | User guide (monthly routine, tax season, emergency) | `[ ]` |

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

## Change log

| Date | Change |
|---|---|
| 25 Oct 2026 | Plan created. Phase 1 closed. Somesh loan finding corrected per your clarification. Repo attached; Phase 1 documents committed. |
| 25 Oct 2026 | Monorepo scaffolded (Next.js 16, React 19, TS 5.9, Vitest). First tested core modules: XIRR, FD accrual, freshness (26 tests passing). CI workflow added. |
