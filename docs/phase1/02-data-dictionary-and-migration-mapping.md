# Phase 1 — Data Dictionary and Migration Mapping

## 1. Column dictionary (sheet `Oct 2026`)

| Col | Header | Meaning (as actually used) | Notes |
|---|---|---|---|
| A | (none) | Group header, merged over rows: `Institution - Owner`, or for SIPs `SIP - <goal person> (<PAN holder>)`, or a counterparty name. | Owner = text after the last `-`; institution = text before it. |
| B | Category | Instrument line: `FD`, `FD-NRE-####`, `FD-NRE JO-####`, `Cash-NRO-####`, fund name (with `(STOPPED)` prefix), counterparty. | Embeds product, NRE/NRO, joint flag (`JO`) and last-4. |
| C | Rate | FD interest rate (decimal). | Misused in C107 (date) and C108 (text). |
| D | Start Date | FD booking date; SIP/fund first investment date; `Cash Loan` text on loan rows. | |
| E | Maturity Date | **Overloaded:** FD maturity date · account type (`Cash-NRE`, `Cash-NRO`, `Cash SG`) · goal (`SIP Advika Education` …) · category (`Cash Loan`, `Shares`). | Drives row classification. |
| F | Amount | FD principal · cash balance · fund current value · loan principal outstanding. | Mixed basis. |
| G | Maturity | FD bank maturity value · `=F` for cash and funds. | Mixed basis. |
| H | Invested | Funds only: cumulative invested (net of stamp duty). | |
| I | P&L | `=G-H` | |
| J | (blank header) | The word `today` on four stopped funds. | Meaning unknown. |
| K, L | Goal, Type | Empty. | Unused headers. |
| M | Changes Req | Admin tasks per institution (address, KYC, mobile, maturity instructions). | → `tasks`. |
| N | Notes | Free text: minimum balance (`AMB - 10K`), lounge-card entitlements, FD numbers, NAV/units/return %, history of loans, SGD balance and FX base. | Parsed selectively. |
| P–T | Prev / This / Saved / Per-day / Rate | Snapshot comparison. | Not trusted (finding F6, F7). |
| V–X | Maturity / category / goal summaries | Pasted values. | Reconciliation targets only. |
| Z–AB | Start-FD summary | FDs by booking date. | Reconciliation target only. |
| rows 118–124 | Plans | Term, health (SG/India), ULIP, NPS, property by family member. | → `policies`, `assets`. |

## 2. Row classification (import rules)

Each row 3–113 is classified, in order, by the first matching rule. Every rule is covered by a unit test fixture in Phase 2.

| Rule | Test | Kind | Target |
|---|---|---|---|
| R1 | `E` is a date | FD | `assets(type=fd)` + `fixed_deposits` |
| R2 | `E` in `Cash-NRE`, `Cash-NRO` | Indian bank balance | `accounts` + `observations` |
| R3 | `E` = `Cash SG` | Singapore balance | `accounts(currency=SGD)` + `observations` (S$ parsed from note) |
| R4 | `E` starts with `SIP` | Mutual-fund line (or ULIP if B contains "Wealth Smart Plus") | `mf_holdings_opening` / `policies` |
| R5 | `E` = `Cash Loan` | Receivable | `receivables` |
| R6 | `E` in `Shares`, `Options & Future` | Third-party-held / trading position | `assets(type=third_party_held)` |
| R7 | `E` = `FD` and `F` empty | Closed FD placeholder | skipped, logged |
| R8 | otherwise | Unclassified | `import_exceptions` for review |

Owner resolution: `A` → `owner` using a mapping table you confirm once (`Rupash`, `Ragini`, `Advika`, `Viraj`; SIP headers use the **PAN holder in brackets**, e.g. `SIP - Advika (Rupash)` = Rupash's PAN, for Advika's goals). Third-party names (`Atul …`, `Anup …`, `Finvasia (Atul)`) map to *holder* = that person, *beneficial owner* = Rupash.

## 3. Mapping to the target model

| Sheet content | Target | Key transformations |
|---|---|---|
| Institution/owner groups | `institutions`, `owners`, `accounts` | Account identity = institution + owner + type (NRE/NRO/SB/joint) + last-4. Collisions listed in the import report. |
| Cash rows | `observations(kind=balance)` | `as_of` = **workbook date** (set by you; default 25 Oct 2026), `source=import:workbook`, `confidence=manual_unverified`. Never presented as "today's balance". |
| FD rows | `fixed_deposits` | principal, rate, booking, maturity, compounding=quarterly (verified), bank maturity value (col G) stored separately from the app's accrual estimate. FD number → last-4 only. |
| 2 matured RBL FDs | `fixed_deposits(status=matured_unconfirmed)` | Excluded from net worth until confirmed (F3). |
| SIP groups | `mf_folios`, `sip_plans` | Active `₹/month` parsed from `N` (e.g. `10K/Month`); `(STOPPED)` → `status=stopped`. Folio and scheme codes are *missing* — filled from CAS. |
| Fund current value / invested | `mf_opening_positions` | Provenance `manual_workbook`; excluded from XIRR and lots until CAS replaces them (F9). |
| NAV, units, `xx.xx%` in notes | `import_hints` | Informational; never used as authoritative values. |
| `SIP <goal>` tag | `goals`, `goal_allocations(method=percent, pct=100)` | One goal per fund as currently tagged; you can split later. |
| Loans | `receivables`, `receivable_payments` | Ravinder: 50,000 lent, 43,000 returned 1 Sep 2024 → outstanding 7,000. Somesh (two items): ₹50,000 and ₹2,00,000, both outstanding (the 4 Jul 2026 date is the expected return, now overdue — confirmed not received). |
| Anup / Finvasia / Atul rows | `assets(type=third_party_held, holder≠beneficial_owner)` | Separate "third-party held" category; counted only if you confirm value. |
| Insurance/ULIP/NPS/property rows | `policies`, `assets` | Coverage stored but excluded from net worth; ULIP value ₹60,515 counted once (it appears in the SIP block *and* the plans block); property ₹25 L (purchase value, valuation date = purchase date until updated). |
| Column M tasks | `tasks` | Linked to institution/owner. |
| Rows 118–124 amounts | `policies` | Coverage amounts and "who pays" (e.g. employer). |
| V:X, Z:AB, P:T | **Not imported** | Used by the reconciliation script to assert the new ledger reproduces: FD principal 1,91,79,860; maturity value 2,34,08,127; goal subtotals; SG cash 30,98,388. |

## 4. Reconciliation report (generated at migration)

The import produces a report with four sections, never a silent drop:

1. **Imported cleanly** — count and total per kind.
2. **Imported with warning** — each finding code (F2–F13) with the cell reference.
3. **Needs your input** — items excluded from net worth until resolved.
4. **Not imported** — every skipped cell range and the reason.

Acceptance check: sum of imported FD principal, cash, fund values and loans must equal the sheet's column-F total **less the explicit exclusions** listed in section 2 of the report (the matured RBL FDs only; the Somesh loan stays outstanding). A difference of ₹1 or more fails the migration.

## 5. Provenance on every migrated value

`source = import:workbook`, `source_ref = <sheet>!<cell>`, `imported_at`, `as_of`, `confidence`. The original workbook is kept in private, encrypted storage and is never committed to Git.
