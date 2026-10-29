# Dashboard, cards and reporting enhancement — current-state audit

Written 29 Oct 2026 before any change. Restore point: branch `checkpoint/before-dashboard-enhancement`. Nothing in this
project removes, renames or hides an existing card, route or calculation; every change below adds to a page or enriches a card.

Feasibility classes used throughout: **A** implement now · **B** implement with a limitation · **C** estimate from existing data ·
**D** cannot be calculated · **E** technically blocked.

## 1. Existing cards by page (preserved; all stay)

| Page | Cards, charts and tables today | Data source → calculation |
| --- | --- | --- |
| Home | Net worth today; deltas today / last N days; How much is verified; More figures (Cash and deposits, Next maturity, Mutual funds, Goals on track, Needs you, Above insured limit); Own money and profit; Wealth movement (period selector + custom months); By kind of holding (FD, MF, Cash incl. foreign, Others); Needs you; Coming up; Net worth over time (1M–All); Money put in and growth; Where the money is (whose money, NRE/NRO, by currency); Goals | `loadHome` → `aggregateNetWorth`, `positionGains`, `valueTrust`, `capitalLedger`, `wealthMovement`, `classCards`, `attentionItems`, `upcomingEvents`, snapshots → `rangeView`, `allocationOf`, `summariseGoals` |
| Accounts | In banks today (gain, earned today, invested → maturity, where it sits, more figures, whose money, NRE/NRO); person filter; bank table with search/sort/filter/CSV; foreign-currency accounts with the rate used; manage tab | `buildBankBlocks`, `bankOverview`, `cashRatesFor`, `foreignLines` |
| Cash | Cash available today; foreign lines; what it earns; by bank; more figures incl. **balances out of date**; whose cash; NRE/NRO; savings register with listing tools | `cashBlocks`, `cashByBank`, `largestCash`, `bankOverview` |
| Deposits | Fixed deposits today; invested → maturity; by bank; maturity ladder by year; whose deposits; NRE/NRO; register (by bank / person); confirm what happened; maturing in the next N days (one window); maturity calendar by month; by bank; by ownership name (DICGC); banks outside the scheme | `buildDeposits`, `maturityLadder`, `dicgcPosition`, `maturityVariance` |
| Investments | Portfolio hero (put in, profit, XIRR, booked by selling, total gain, SIP, long-term share); history completeness; value vs money put in; return over time; goal by goal; movers; next SIPs; person vs person; Performance (P&L by period vs previous, heatmap, benchmark, drawdown, risk, rolling returns); value by period + CSV; funds table; transactions ledger (search, FY filter, CSV); breakdown (kind, AMC, fund, person, Direct/Regular, unit age, gain by fund, long-term share, SIPs, gains booked) | `loadInvestmentView`, `portfolioPerformance`, `periodPL`, `returnProfile`, `valuationHistory`, `realisedSummary`, `sipBlock` |
| Goals | Set aside; extra needed a month; goal cards with funded % and shortfall; money not set aside | `projectGoal`, `goalCardFigures` |
| Reports | Deposits: KPIs, maturity and start summaries by period, deposits by bank/owner/kind/rate/tenure, interest by FY. Funds: KPIs, funds by fund/owner/category/AMC/goal, SIP summary, money in and out by period, unit age. CSV on every table | `fdSummary`, `fdBreakdown`, `fdInterestByFy`, `fundSummary`, `sipTable`, `fundFlow`, `fundAge` |
| Others | Owed to you, overdue loans, renewals, property and other; tabs with listing tools | `receivableStatus`, others summary |
| Tax, Tax filing | Harvest plan per person; refunds + CSV; simulator; FD interest per FY + CSV; 26AS/AIS check; capital gains per FY + 112A CSV | `planHarvest`, `interestSchedule`, `reconcileTax`, `classifyGains` |
| Retire, Raise, New money, Reconcile, Trail, Rates, Monthly, Settings | As built (simulations, liquidity plans, rate boards, statement review, money trail, monthly update, settings) | see each page |

## 2. Data that already exists (and supports the new work)

- **observations**: every balance and value, dated (`as_of`), with `received_at`, `source` and `confidence`: the effective date and
  the receipt date are already distinct.
- **snapshots**: daily net worth with `by_type`, `by_owner`, `by_liquidity`, `basis` — history for period comparisons.
- **fixed_deposits**: principal, rate, booked/maturity dates, compounding, payout, bank maturity amount, ended_on.
- **mf_positions / mf_transactions / mf_navs / mf_snapshots**: units, cost, dated cash flows (source `cas` vs `estimate`), prices.
- **fx_rates**: SGD→INR by date. **statement_lines**: bank transactions for accounts with statements. **money_moves**,
  **remittances**: money put in and moved. **goals / goal_allocations**, **receivables / payments**, **policies**,
  **cashflow_items** (income and spending: unused by reports so far), **tds_refunds**, **tax_statements**.

## 3. Gaps against the brief, with feasibility

| Requested | Today | Class | Note |
| --- | --- | --- | --- |
| Separate cards: cash in INR, cash in SGD (native), SGD in INR with rate and date, total cash | SGD lines exist inside other cards; no separate cards | **A** | `foreignCash` already gives native amount, INR value, rate and rate date |
| FD principal and interest shown apart; total FD value | totals exist inside the deposits panel | **A** | value today = principal + interest earned to date (from terms: an estimate unless bank-confirmed) |
| MF value, cost of current holdings, unrealised gain on Home | partly (hero on Investments) | **A** | from the fund engine |
| Net worth per person as cards with change vs last month / quarter / year | whose money (no change) | **A** | snapshots `by_owner` |
| Liquid assets with a precise rule | liquidity buckets exist, no headline | **A** | rule shown on the card: cash + deposits + funds; property, lent money, policies and retirement accounts excluded |
| Changes vs previous month, quarter, year per class | net worth only | **A** where snapshots exist; **B** before the first snapshot | |
| Stale or unverified records (one list) | spread over several cards | **A** | freshness + confidence |
| FD maturities in 7/30/60/90 days | one window | **A** | `maturityAlerts` exists, unused |
| Expected FD interest over the next 12 months | no | **C** | from recorded terms; labelled estimated |
| Emergency reserve / months of spending covered | no | **A** when spending items are entered in Settings; **D** otherwise | `cashflow_items` |
| Realised gains for any period, contributions and withdrawals for any period | FY only (tax) / fund flow by period | **A** | fund ledger; estimated SIP lines are flagged |
| SIP confirmed vs planned | not side by side | **B** | statement lines vs `estimate` lines; a SIP with no statement yet stays "not confirmed" |
| Direct/Regular, index/non-index, Growth/IDCW | Direct/Regular only | **A** (from scheme names and plan type) | classification shown with its basis |
| Equity vs debt | fund category exists for most schemes | **B** | schemes with no category are listed as "not classified" |
| Interest earned on savings | statement interest where statements exist | **B** | accounts without statements: estimate from rate, labelled |
| Currency-related change | snapshot `components.fx` | **B** | only for days with snapshots |
| Reports Centre: periods, templates, combined filters, comparisons | Reports page with two templates | **A** for templates over existing data; see section 4 |
| PDF export | none (print exists for the handbook) | **A** as a print layout (browser "Save as PDF") | no server PDF engine is added |
| XLSX export | none | **A** | reuses the Excel library already in the project |
| Saved / favourite / recent reports | none | **A** | needs one small table (optional, additive) |
| Natural-language report shortcuts | none | **C** | a phrase is turned into visible filters, which the person checks before the report runs |
| Liabilities | none recorded | **D** | no loans are recorded; the card says "none recorded" and is not a zero |
| Property value history | observations exist for property | **B** | only as often as a value was entered |
| Secure sharing of exports | WhatsApp summary exists | **B** | files are downloaded by the signed-in person; no public links are created |

## 4. Reports Centre (planned)

Periods: today, yesterday, this/last week, month, quarter, financial year (Apr–Mar), calendar year, last 7/30/90 days, last 12
months, year to date, since inception, custom. Templates (each section runs on what exists; a missing section says why):
net worth, cash and bank, fixed deposits, mutual funds, investment transactions, performance, tax and capital gains, SIPs and
contributions, goal funding, SGD and currency, receivables, insurance/pension/property, retirement readiness, data quality.
Filters: owner, bank/account, asset class, currency, AMC, scheme, plan, option, goal, tax class, transaction type, dates, source,
verification, amount range. Group by owner, month, quarter, FY, year, bank, AMC, scheme, currency, class, goal, type. Exports:
CSV, XLSX, print/PDF; saved configurations rerun against today's data.

## 5. Genuine limitations

- No liabilities are recorded (**D**); the brief's liability lines show "none recorded".
- Accounts without bank statements have balances, not transactions: their change is a balance change, never "deposits and
  withdrawals" (**B**).
- Before the first snapshot, net worth can only be shown where the history import rebuilt it (**B**).
- Fund categories missing for a few schemes leave them "not classified" in equity/debt splits (**B**).
