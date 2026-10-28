# Implementation report: the valuation, capital and reconciliation brief

Report required by section 17 of the implementation brief (MASTER_IMPLEMENTATION_PROMPT). It records what was changed, how each figure
is worked out, how the 16 acceptance tests are covered and what they returned, and what is still limited. It contains no household
figures: the live check prints totals only to its own log.

## 1. Summary of changes

| Phase | What changed |
|---|---|
| P0 Definitions | One glossary of every figure (`docs/DEFINITIONS.md`, generated from `packages/core/src/figure.ts`). Every figure is one of five kinds: actual, estimate, market, projection, history. A consistency test checks that Home, the ledger, Wealth movement, fund views and the e-mail digest agree. |
| P1 One engine | Every holding is valued by one engine (`position.ts` → `valuation.ts`). The older portfolio function is now a thin adapter over it, so every page reads the same value. |
| P2 Savings | A savings value is the last confirmed balance moved forward by confirmed money in and out and by interest: balance slabs (whole or incremental), rate changes by effective date, quarterly crediting, tax at source. A new actual balance becomes the new baseline. |
| P3 Deposits | Deposits are valued from their contract (cumulative or payout). On maturity the proceeds are counted once, "awaiting confirmation", until you say where they went. They are never reinvested or assigned automatically. Funding sources for new deposits are recorded. |
| P4 Capital ledger | Own money put in, profit so far, XIRR and time-weighted return. Net worth = opening position + confirmed outside money + money not yet explained + profit. |
| P5 Funds | Confirmed units × official NAV are shown apart from projected SIP units. Stale NAVs are flagged. CAMS "Sys. Investment" lines are read as SIPs; cash IDCW payouts are read and counted as money returned. Importing the same statement twice adds nothing. Cost basis is FIFO. |
| P6 Stocks, loans | Not built: the family holds no listed shares and has no loans. A `stock` holding type already exists; a loan would need a liabilities table and a "less loans" line in net worth. |
| P7 Daily job, freshness | A valuation snapshot is stored every night at 00:10 India time. Pages recalculate on every visit. Each holding shows its date and basis; Home shows which fund prices are older than the setting. |
| P8 Performance by period | Wealth movement for a month, 3 months, 6 months, FY, 12 months, all time or custom months. Outside money is kept apart from what was earned, with a time-weighted return. |
| P9 Dashboard, transparency | New Home layout (summary, capital, movement, kinds of holding, needs-you). New **Explain movements** page. Every deposit, savings and fund detail page shows how today's value is worked out, line by line, each marked actual, estimate or projected. |
| P10 Acceptance | All 16 acceptance tests automated (section 8). Live numbers check run on the real database. |

Work outside the brief that changed the same figures:
- **Bank e-mail reader:** rules for each bank's alert format (HDFC, YES, RBL, Equitas, ESAF, Jana, IDFC) and the new `.bank.in` sender domains.
- **Fallbacks:** the AI reads any other format; nothing under the label is skipped; you can type a balance when nothing could be read.
- **Same-day alerts:** two alerts on one day are kept in time order.
- **Learning:** choosing the account for an alert saves its last four digits.
- **Rates:** Settings has a "Sync now" button for each bank's rates.

## 2. Files, interfaces and database

**Core (`packages/core/src`)**
- New modules:
  - `figure.ts`: figure kinds and the glossary;
  - `deposit-contract.ts`: deposit contract, payouts, maturity proceeds;
  - `savings-accrual.ts` and `savings-rates.ts`: savings accrual and rate schedule;
  - `valuation.ts`: engine to net worth;
  - `capital.ts`: capital ledger, XIRR, TWR, wealth movement;
  - `fund-views.ts`: confirmed vs projected funds;
  - `reconcile.ts`: the Explain movements queue.
- Changed: `position.ts`, `period-gains.ts`, `position-build.ts`, `portfolio.ts`, `performance.ts` and `fund-timeline.ts` (IDCW payouts), `home.ts`, `explain*.ts`, `networth.ts` (valuation detail on each row).

**Data and workers**
- `packages/data/src/ledger.ts`: money movements and capital inputs.
- `daily-valuation.ts`: nightly snapshot.
- `workers/src/market-data.ts`: runs the nightly snapshot.
- `workers/src/inbox.ts`: e-mail times, same-day replacement.
- `workers/src/numbers-check.ts`: read-only live check.

**Ingest**
- `bank-email.ts`: per-bank rules, `.bank.in` domains.
- `forwarded.ts`: original time of a forward.
- `inbox-run.ts`: AI fallback, same-day order, no skipping.
- `cas.ts`: SIP short form, IDCW payouts.

**Web**
- New pages and components: `/reconcile` (Explain movements), `dashboard/Movement.tsx`, and the "All fetched" tab on Bank emails.
- Detail-page value breakdowns in `lib/detail-view.ts`.
- The Settings rate check now offers Sync now.

**Database migrations**
- `20261028000200_money_moves.sql`:
  - the `money_moves` ledger (idempotent by key, row level security, audit);
  - `institutions.savings_slab_method`;
  - `asset_rate_history` and its trigger.
- `20261028000300_fund_line_kinds.sql`:
  - the `dividend_payout` line kind;
  - 83 stored "Sys. Investment" lines reclassified as SIP, with their references kept in step.

**New settings:** savings credit frequency and slab method, unexplained tolerance, the capital opening date, the NAV staleness days, and the Gmail time zone for forwarded alerts.

## 3. Methodologies

- **Savings.** Value on a day = last confirmed balance + confirmed money in and out since + interest since.
  - Interest accrues daily on the balance at the rate in force (slabs, effective dates), is credited on the bank's schedule (quarterly by default) and is net of tax at source.
  - Moves dated *d* count from *d*+1.
  - A new actual balance resets the baseline. Any difference from the estimate above the tolerance is "not yet explained", never profit.
- **Deposits.** Valued on the contract: cumulative deposits compound on their schedule; payout deposits keep principal and record interest paid.
  - A deposit is running on its maturity day; its money is out from the next day.
  - Proceeds are counted once until placed, or until the evidence says they were placed: a renewal at the same bank within −3/+15 days with principal ±2%, or a later balance in the linked account.
  - After the hide window (60 days, Settings) they are assumed placed.
- **Funds.** Confirmed value = statement units × the latest official NAV on or before the day.
  - SIP instalments after the last statement are projected units, shown apart.
  - An upcoming instalment is never valued before its NAV exists.
  - A NAV older than the setting (4 days) is flagged.
  - Cost basis is FIFO.
  - A reinvested IDCW is not a cash flow; a cash IDCW is money returned.
- **Capital and returns.** Own money = opening position + confirmed outside money + money not yet explained.
  - Profit = net worth − own money.
  - XIRR uses dated outside flows; unexplained sums are placed mid-month.
  - Time-weighted return chains monthly returns and skips months the flows dominate.
  - Periods are whole calendar months; the day closes at end of day India time.

## 4. Actual, estimated and projected

Every value carries its kind:

| Kind | Meaning | Examples |
|---|---|---|
| **Actual** | A balance, unit count or price on record for that day. | A recorded balance. |
| **Estimate** | Worked out from an actual figure by a rule. | Interest since the last balance; a deposit's accrual; proceeds awaiting confirmation. |
| **Market** | Confirmed units × an official price. | A fund valued from its statement. |
| **Projection** | Future or unconfirmed. | SIP units after the last statement; future maturities. |
| **History** | Past snapshots. | The nightly valuation records. |

Where each kind is visible:
- **Home:** what share of the total is confirmed, calculated or older.
- **Detail pages:** each line is marked.
- **Explainers:** the "?" panel on each figure shows its basis and dates.

## 5. Capital tracking

- **Internal movements are not new money:** transfers between your own accounts, deposit renewals, reinvested interest and reinvested fund gains are internal and never raise own money.
- **Outside money must be confirmed:** salary, gifts or money taken out raise or lower own money only when confirmed on Explain movements.
- **Unexplained changes are kept apart:** a balance change nobody has explained is shown as "not yet explained" — counted as own money, never as profit.
- **Opening position:** the later of the first savings, fund and deposit records; Settings can override it.

## 6. CAS and SIP behaviour

- **Statement imports:** a statement import reconciles holdings, lines, units, cost and SIP status.
- **Re-imports:** each line has a stable key, so a re-import adds nothing (acceptance test 7).
- **Projections between statements:** an active SIP keeps projecting instalments, shown apart from confirmed units.
- **SIP amount changes:** a change applies from its effective date; history keeps the old amounts.
- **Stopping a SIP:** a SIP is stopped only on reliable evidence (a cancellation in the statement, or no instalments over the configured count). A statement that simply lacks recent lines does not stop it.

## 7. Dashboard consolidation

Home answers, in order:
1. What the family is worth.
2. How it changed.
3. How much of it is verified.
4. Own money, profit and return.
5. Wealth movement for a period.
6. The four kinds of holding.
7. What needs you.
8. What is coming.
9. The trend.
10. Where the money sits.
11. Goals.

Removed because they repeated other figures: the separate FY tile, the money, periods, banks, funds and liquidity cards, and the "changed" and "risks" panels. A browser test checks that no headline label repeats (acceptance test 15).

## 8. Tests and their results

Run on 28 Oct 2026:

| Suite | Result |
|---|---|
| Core unit tests | 1188 passed |
| Ingest unit tests | 628 passed, 1 skipped |
| Data unit tests | 21 passed |
| Web unit tests | 449 passed |
| SQL tests (fresh Postgres 16, every migration, row level security) | All passed, including `99_money_moves` and `99_fund_line_kinds` |
| Browser tests (phone, tablet, desktop) | Full suite: 936 passed, 3 skipped. Every page changed since was re-run and passed. CI runs the full suite on every push. |
| Lint | Clean |
| Live numbers check (read-only, real database) | Every check passed: kinds and people add up to net worth; Home equals the portfolio; net worth = own money + profit; the ledger equals the portfolio; the engine equals the portfolio for every kind. |

Acceptance tests from the brief:

| # | Test | Where | Result |
|---|---|---|---|
| 1 | Savings interest; a new balance is the new baseline | `core/test/savings-accrual.test.ts` | Pass |
| 2 | FD maturity and reinvestment: own money stays at the original deposit | `core/test/capital.test.ts` | Pass |
| 3 | Savings interest reinvested in an FD: counted once | `core/test/capital.test.ts` | Pass |
| 4 | Maturity proceeds never reinvested or assigned automatically | `core/test/deposit-contract.test.ts`, `reconcile.test.ts` | Pass |
| 5 | SIP projections between statements, apart from confirmed units | `core/test/fund-views.test.ts` | Pass |
| 6 | SIP changes by date; stopping only on reliable evidence | `core/test/fund-views.test.ts`, `fund-import-diff.test.ts` | Pass |
| 7 | CAS reconciliation; the same CAS twice adds nothing | `ingest/test/cas.test.ts`, `cas-import*.test.ts` | Pass |
| 8 | Fund value from confirmed units and the latest official NAV; stale warning | `core/test/fund-views.test.ts`, `e2e/home.spec.ts`, `e2e/detail.spec.ts` | Pass |
| 9 | Capital: internal movements do not raise own money | `core/test/capital.test.ts` | Pass |
| 10 | Return percentages: stated denominator, dated flows, no precise figure when invalid | `core/test/capital.test.ts` | Pass |
| 11 | Historical performance against snapshots and flows; limitations stated | `core/test/capital.test.ts` | Pass |
| 12 | Family wealth not inflated by movements between kinds | `core/test/capital.test.ts` | Pass |
| 13 | Time progression with nothing recorded | `core/test/time-progression.test.ts` | Pass |
| 14 | Global consistency across pages, e-mail and ledger | `web/lib/consistency.test.ts` | Pass |
| 15 | Dashboard quality: responsive, readable, no repeated headline figure | `web/e2e/home.spec.ts` | Pass |
| 16 | Missing and inconsistent data flagged, not fabricated | `core/test/reconcile.test.ts`, `position.test.ts` (no value is never zero) | Pass |

## 9. Remaining limitations

1. **Most money moved in the past is worked out from balances, not confirmed.** It is shown apart and never as profit. It becomes exact as you answer the items on Explain movements: balances that changed more than expected, and deposits with no source.
2. **Opening position.** Only part of the holdings had a value on the first day of records. The others count as money moved in on the day they were first recorded. You can set the opening date in Settings.
3. **Funds without a statement are valued from the SIP plan.** Seven funds have no ledger; four funds have no official scheme matched, so they have no live price. Importing a CAS for each person makes them exact.
4. **Bank accounts with no last four digits** (YES, RBL, HDFC, IDFC, IndusInd, AU) cannot be matched to alerts automatically until the digits are saved. Choosing the account once on Bank emails saves them.
5. **Forwarded alerts and time zones.** The time of a forwarded alert comes from the forward header, read in the Gmail time zone set in Settings. A direct and a forwarded alert for the same account on the same day can be misordered if that setting is wrong.
6. **Cash IDCW payouts** count as money returned by the fund. The matching credit in the bank is not linked automatically; mark it as a transfer from the fund on Explain movements. No fund held today pays IDCW.
7. **Stocks and loans are not modelled** (none held today).
8. **Historical snapshots** before the nightly job began were rebuilt from the monthly tabs. They are monthly, not daily, and partly estimated.
