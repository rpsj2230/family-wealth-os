# Phase 1 — Open Questions, Missing Fields and Working Assumptions

## A. Needed to finish the migration (please answer first)

| # | Question | Why it matters |
|---|---|---|
| A1 | The two RBL FDs (₹5 L each, Rupash and Ragini) matured on 23 Sep 2026. Were the proceeds renewed (the 8 Sep 2026 RBL FDs?), credited to another account, or still pending? | Possible ₹10 L double count (F3). |
| A2 | ~~Somesh ₹2,00,000~~ **Resolved:** not received, remains outstanding (overdue since 4 Jul 2026). Still open: what is the status of the separate ₹50,000 "Haar Me" item, and should interest or a new expected date be recorded? | F4. |
| A3 | What does `JO` mean in `NRE JO-0278`, and who are the joint holders (and in what order) for each joint account? | DICGC aggregation and ownership split. |
| A4 | Advika and Viraj: do they hold PANs, are the accounts minor accounts operated by a parent, and should they appear as separate owners in the household view? | Four owners, not two. |
| A5 | What date does each balance represent (the sheet is titled Oct 2026)? Default I will use: **25 Oct 2026**. | Effective dates. |
| A6 | The five funds with a 4 Jan 2026 start date: is that 4 January, 1 April, or something else? | Instalment counts do not match (F10). |
| A7 | What does `today` in column J mean on four stopped funds? | F11. |
| A8 | Duplicate FD reference on two Jana FDs (Rupash, 26 Oct 2025 and 8 Sep 2026): which is correct? | F12. |
| A9 | Do earlier monthly sheets exist? If yes, please share them. | Rebuilds net-worth history (F7). |
| A10 | Can you download a **consolidated CAS** (CAMS + KFintech, all-time, detailed) for each PAN, or a Kuvera transaction export? | Only way to get true ledgers, units, lots and XIRR (F9). |

## B. Needed for the retirement engine (the workbook has none of these)

| # | Input | Note |
|---|---|---|
| B1 | Current monthly household spending (split Singapore / India if useful) | No expense data exists today. |
| B2 | Expected monthly spending after retiring in India, in today's rupees | Drives the required corpus. |
| B3 | Monthly income and expected income growth/ending date | Needed for contribution forecasts; the sheet's "Ideal" saving of ₹2.64 L/month (₹8,800/day) is not defined. Is that your target? |
| B4 | Planning age for the younger spouse (default **95**; Ragini turns 55 when you turn 60 on 10 Jun 2048) | Withdrawal horizon of ~40 years. |
| B5 | Planned one-off costs: children's education (India or overseas, year, today's cost), marriage, vehicles, home | Goals currently exist only as fund tags. |
| B6 | Bhopal flat: any loan? Will it be your retirement home, rented, or sold? Current value | Property is excluded from spendable funds unless modelled. |
| B7 | Will you return to India before 60 (change of residency)? When? | Changes NRE/NRO treatment and tax. |
| B8 | Which goals should the FDs/cash fund? Today ₹1.92 Cr of FDs has no goal tag. | Goal allocation. |

## C. Insurance and emergency register fields to collect

For each policy: insurer, policy type, insured, owner, premium, premium frequency, next due date, sum assured, policy term/expiry, nominee, claim contact, document location. Specifically missing: HDFC Life term policy expiry age and nominee; Great Eastern renewal date; Niva Bupa renewal date; AIA (employer, ends with employment); ULIP withdrawal conditions; NPS (confirm none).
Family emergency page: trusted contacts, will/estate-document location, nominee details per account/folio, broker/demat accounts, who holds each document.

## D. Working assumptions (I will proceed with these unless you object)

1. Everything is reported in **INR**; S$ balances are entered in S$ and converted at a dated rate for display only.
2. Tax and product logic is **India-only** (NRE/NRO, Indian mutual funds, TDS refunds via ITR).
3. FDs accrue on **quarterly compounding** (verified against all 33 FDs).
4. Funds are treated as **Direct plans** unless the scheme name says otherwise.
5. Each fund keeps its current single goal tag until you split it.
6. Per your instruction, **clubbing/gift tracking is not modelled** for assets funded via NRE accounts; a nullable `source_of_funds` field is kept so it can be switched on later.
7. Both spouses have full visibility and edit rights.
8. PANs, accounts, FDs and policies are stored **masked (last 4)** only.
9. Third-party-held money is shown separately and counted only after your confirmation.
10. Retirement results are always labelled as projections under stated assumptions, and are withheld ("insufficient data") if B1–B3 are missing.
