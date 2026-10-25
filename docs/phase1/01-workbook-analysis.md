# Phase 1 — Workbook Analysis

Source: `Summary - Bank Reports.xlsx` (one sheet, **"Oct 2026"**). Analysed programmatically with `tools/analyse_workbook.py`; every figure below was recomputed from the cells, not copied from the sheet's own totals. Identifiers (FD numbers, policy numbers) are intentionally omitted.

## 1. What the workbook is

| Aspect | Finding |
|---|---|
| Sheets | 1 (`Oct 2026`). Prior months, if they exist, are not in this file. |
| Used range | Rows 1–124, columns A–AB (the declared range A1:DB1105 is formatting residue). |
| Formulas | 200, all trivial: `=F#`, `=Q#-P#`, `=R#/W$7`, `=G#-H#`, four `SUM`s, a few unit conversions. **No XIRR, no accrual, no lookups.** |
| Layout | Block A–N = register (institution/owner → instrument rows); P–T = "Overall" snapshot comparison; V–X = hand-pasted summaries; Z–AB = FDs grouped by start date; rows 118–124 = insurance, ULIP, NPS, property. |
| Owners present | **Four**, not two: Rupash, Ragini, **Advika**, **Viraj** (the last two hold NRE/NRO FDs at Equitas). |

## 2. Headline figures (as recomputed)

All amounts in ₹. "Sheet basis" mixes bases (see finding F2); a true net worth needs the accrual and valuation rules in the schema proposal.

| Group | Records | Amount | Basis |
|---|---:|---:|---|
| Fixed deposits | 33 | 1,91,79,860 principal (2,34,08,127 at maturity) | principal |
| NRE cash | 24 rows | 52,20,392 | balance (undated) |
| NRO cash | 10 rows | 4,35,406 | balance (undated) |
| Singapore cash (UOB, DBS) | 2 | 30,98,388 (S$47,667.51 at the sheet's ₹65/S$) | balance (undated) |
| Mutual funds (25 funds) | 25 lines | 46,39,163 value; 39,13,215 invested; **P&L +7,25,948 (+18.5%)** | hand-copied value |
| ULIP (Aditya Birla, stopped) | 1 | 60,515 | listed inside the SIP block |
| Stocks/F&O placeholders | 2 | 1,00,000 | memo |
| Loans given | 3 | 2,57,000 | principal (see F4) |
| **Sum of column F** | | **3,29,90,725** | mixed |
| Sum of column G ("Maturity") | | 3,72,18,992 | mixes future FD values with today's balances — **not a net worth** |

FD principal by owner: Rupash 88.00 L · Ragini 83.66 L · Advika 11.14 L · Viraj 9.00 L.
Mutual funds by PAN-holder section: Rupash ≈ 32.22 L (16 funds) · Ragini ≈ 14.17 L (9 funds).
Active SIPs: **₹1,15,000/month** (₹60k + ₹35k + ₹20k — matches the section headers exactly). 13 funds are active; 12 are "STOPPED" (SIP stopped, units still held).
Other: term cover ₹1.5 Cr (Rupash only), ULIP value ₹60,515 (stopped, maturity/withdrawal 1 Aug 2029), NPS blank, one flat in Bhopal ₹25 L (bought 15 Dec 2023). No liabilities recorded. No income or expense data anywhere in the workbook.

## 3. Things the workbook does well (preserved by design)

1. **Compact register per institution and owner**, with NRE/NRO/joint distinguished in the label.
2. **FD maturity figures are credible.** I recomputed each of the 33 maturity amounts using quarterly compounding; all agree with the sheet to within **0.04%**. The app will accrue FD value daily on this convention and show variance against the bank-quoted maturity amount.
3. **SIP bookkeeping is consistent**: per-person monthly SIP totals equal the sum of the fund notes.
4. **Goal subtotals reconcile**: the pasted goal totals (Advika Education 33.81 L, Advika Marriage 0.78 L, Retirement 4.39 L including the ULIP, Viraj Education 7.62 L, Viraj Marriage 0.39 L) equal the sum of the tagged fund rows.
5. **Admin tracking** in column M ("Address Change", "KYC Completed", "Change Maturity Instructions", "Ragini Mobile Old") is a real workflow; it becomes a Tasks feature rather than being lost.
6. **DICGC-aware structuring**: FDs are deliberately split into ₹5 L blocks and across single/joint accounts. The app will calculate the insured/uninsured position properly (principal + accrued interest, per bank, per depositor capacity).

## 4. Data-quality findings

Severity: **H** changes a number you rely on · **M** blocks automation/history · **L** tidy-up.

| # | Sev | Finding | Cells | Proposed handling |
|---|---|---|---|---|
| F1 | M | **Overloaded columns.** `D`/`E` hold a date, an account-type label (`Cash-NRE`), a goal (`SIP Advika Education`) or a category depending on the row. `C` holds a rate, a date (C107) or text (C108). | D–E all; C107, C108 | Import by row *kind*, not column position (rules in doc 02). |
| F2 | **H** | **Mixed bases in totals.** Column F = principal for FDs but market value for SIPs; column G = future maturity value for FDs but today's value for cash. The grand total therefore is neither net worth nor maturity wealth. | F114, G114 | Net worth = FD accrued value to date + latest balances + latest NAV-based MF value. FD maturity shown separately. |
| F3 | **H** | **Matured FDs still counted as active:** RBL (Rupash) and RBL (Ragini), ₹5 L each, matured **23 Sep 2026**. RBL cash shows 0, so the proceeds' location is unknown. Possible renewal (the 8 Sep 2026 RBL FDs?) cannot be told apart from double counting. | rows 14, 17 | Mark `matured – needs confirmation`; excluded from net worth until you confirm renewal or credit. |
| F4 | M | **Overdue loan wording is ambiguous.** Somesh Pratap ₹2,00,000 (lent 20 Jun 2025) carries the note "Returned on 4 July 2026". You have confirmed it has **not** been received, so it stays outstanding and the note is read as the *expected* return date, now about 113 days overdue. | F107, N107 | Import as principal ₹2,00,000, outstanding ₹2,00,000, `expected_repayment = 4 Jul 2026`, status *overdue*; reminders enabled. |
| F5 | M | **Pasted summaries go stale.** `V:X` and `Z:AB` are typed values, not formulas. The maturity list still shows 23 Sep 2026; the category table shows **FD = 0** because FD rows are keyed by date, not category. | V17:X52, Z18:AB29 | Not imported. Regenerated live from the ledger. Used only as reconciliation checks. |
| F6 | **H** | **Savings analytics are unreliable.** Date pair is 6 Sep 2024 → 17 Nov 2024 (72 days); both totals equal 26,727,656, so the result is 0. "Saved" treats cash moved into an FD as *negative saving* (e.g. IDFC Ragini 25,000 → 7 = −24,993) and a maturity credit as saving (IDFC Rupash +46.3 L). Per-day figures divide by the stale 72-day gap. | P:T, W5:X14 | Replaced by ledger-based change analysis separating contributions, transfers, interest and valuation change. |
| F7 | M | **Previous-balance column is placeholder data.** The value 54,308 appears in five unrelated accounts (P20, P54, P56, P62, P70); 25,000 in two. | P column | Not imported as history. History starts at this snapshot unless older sheets are supplied. |
| F8 | M | **FX is inconsistent and hard-coded.** SG rows use ₹65 per S$ (UOB S$46,655.19 × 65 = 30,32,587 ✓); the "In Dollar" block divides by 50; "Ideal" saving text implies ~55. The S$ balance lives only in free text (`Bal : $46655.19`). | N103:N104, X12:X14, Y12:Y14 | Store S$ natively with a dated rate; parse the note once. |
| F9 | **H** | **Mutual funds have no ledger.** Only invested amount and a hand-copied current value (from Kuvera / HDFC Securities). No folio, units (except two notes), NAV date or transactions. XIRR, lots and tax harvesting cannot be computed from this data. Invested figures are net of stamp duty (e.g. 25 × ₹10,000 → 2,49,988). | rows 73–98 | Import as an *opening position with provenance "manual"*. Real ledger comes from CAS (CAMS/KFintech) or Kuvera export. |
| F10 | M | **Possible SIP start-date error.** Five funds show a 4 Jan 2026 start, but their invested amounts equal only 8–9 instalments (e.g. ₹95,995 at ₹12k/month). Possible day/month swap or paused SIPs. | D84:D86, D92:D93 | Flag; confirm with CAS. |
| F11 | L | **Unexplained `today` markers** on four stopped funds. | J77, J78, J88, J94 | Ask (doc 05). |
| F12 | M | **Duplicate FD reference.** Two different Jana (Rupash) FDs (booked 26 Oct 2025 and 8 Sep 2026) carry the same FD number. Likely a copy error; the same pattern is not present for Ragini. | N59, N60 | Flag; resolve via statement. |
| F13 | M | **Account suffix collisions.** The same last-4 appears under different banks and for FD, cash and NRO/NRE variants (e.g. `…-1454`). The register can't uniquely identify an account. | col B | Identity = institution + owner + account type + last-4; collisions listed for confirmation. |
| F14 | M | **Third-party arrangements.** Accounts in another person's name holding your money (Atul IndusInd/IDFC, ₹27,866); a trading account via the same person (₹0 now); and ₹1 L shown as "Shares" with another person. | rows 99–102 | Model *holder ≠ beneficial owner*; shown separately, flagged for CA review (see section 5). Not guessed. |
| F15 | L | **Memo item:** "Papa — ₹16 L" family support, "just for records". | row 108 | Memo ledger; excluded from assets. |
| F16 | M | **Sensitive data in clear text.** Full FD numbers in notes, one health-policy number. | col N, B121 | Reduced to last-4 on import; keep the original workbook out of Git (`.gitignore` enforces this). |
| F17 | L | **Insurance gaps/dependencies to confirm** (information only): Singapore cover for you is **employer-provided** (ends with employment); no term cover is recorded for Ragini; no cover recorded for the children; ULIP is stopped. | rows 119–122 | Registered with renewal/expiry fields; shown as notices, not advice. |

## 5. Items for your CA (flagged, not decided by the app)

- **Children's FDs** (Advika ₹11.14 L, Viraj ₹9.00 L) include NRO FDs; income of minors is generally clubbed with the parent's under Indian rules (verify). NRE interest is exempt, so you noted no clubbing concern for NRE — recorded as your instruction.
- **Third-party-held money and trading** (F14): how this is reported, if at all, is a tax/legal question.
- **NRO FD interest** (about ₹18.7 L of principal across four NRO FDs) attracts TDS that you claim back; the filing module will total it per PAN and per FY.
- **DICGC exposure**: on my rough reading, roughly half of the ₹1.92 Cr FD principal is above the ₹5 L-per-bank-per-capacity cover, before interest. This is indicative only; the app will compute it exactly once joint-account membership is confirmed.

## 6. Consequences for the design

1. History starts now. Without earlier monthly sheets or CAS, net-worth history before Oct 2026 and any XIRR before the CAS period cannot be reconstructed, and will be labelled so.
2. The retirement engine has **no expense or income inputs** in the workbook; those must come from you.
3. Only ₹4.4 L (₹3.8 L of funds + the ₹60k ULIP) is tagged "Retirement"; the ₹1.92 Cr of FDs carries no goal. The goal model must allow FDs and cash to be allocated to goals, including percentage splits.
4. Four owners, joint accounts and third-party-held assets require an `owner` model broader than "two PANs".
