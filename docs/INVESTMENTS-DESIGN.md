# Investments: what the best apps show, what we show, what we cannot

Written 26 Oct 2026 for the redesign of the Investments page and the fund page. It records what was studied, the standard
measures and how each is worked out here, what the pages show, and what is left out because the free data does not carry it.
Everything computed is in `packages/core` (pure, unit-tested, nothing hard-coded); the pages only lay it out.

## 1. What was studied

Pages and help articles were read where they could be fetched; where a site blocked the fetch (Value Research, Groww help) only
the search summary was available, and that is said below. Nothing here is copied; it is a list of what an investor expects.

| Source | What it was used for | Verified how |
| --- | --- | --- |
| [INDmoney: portfolio analytics](https://www.indmoney.com/mutual-funds/portfolio-analytics) | Total value (invested, current, absolute return, one-day move); XIRR; returns against a Nifty 50 benchmark; growth split into own contributions and returns; market-cap and sector allocation; equity against liquid split; dividend tracking; overlap | Page read. No expense ratio or Direct-against-Regular figure on it |
| [Groww: Active and Lifetime XIRR](https://groww.in/updates/xirr-feature-update-groww) | XIRR on current holdings against XIRR over the whole history, shown side by side on the fund page | Page read |
| [Zerodha Console: Analytics](https://support.zerodha.com/category/console/portfolio/console-holdings/articles/console-analytics) | Portfolio XIRR for current or historical holdings, a choice of Nifty benchmarks, contributors to returns (top gainers and decliners), dividend and interest by quarter; XIRR is withheld ("-") when most money is under a year old | Page read. Coin's own dashboard (day change, invested, current) was not confirmable from public pages |
| [Value Research: return methodology](https://www.valueresearchonline.com/fund-return-calculation-methodology/) and [rolling against trailing returns](https://www.valueresearchonline.com/stories/50987/rolling-returns-vs-trailing-returns/) | Trailing return is the point-to-point change of the adjusted NAV; under a year it is plain (absolute), from a year it is per year; periods 1W, 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y and since launch; rolling returns are a premium feature | Both pages returned 403; the definitions come from the search summaries of those pages |
| [Morningstar X-Ray (India)](https://www.morningstar.in/posts/64689/get-instant-x-ray-fund-holdings.aspx) | Asset allocation (stocks, bonds, cash), style box, stock overlap between funds, fees | Search summary and FundsIndia's write-up |
| [mProfit features](https://www.mprofit.in/features) | XIRR per investment, capital gains reports ready for filing, import from registrars, returns against benchmarks | Page read (XIRR itself only appears in a file name) |
| [Kuvera: what a tracker shows](https://kuvera.in/blog/what-is-a-mutual-fund-tracker-and-why-you-need-one/) | Returns over 1M, 6M, 1Y, 3Y, 5Y; XIRR that accounts for each SIP instalment; automatic SIP and SWP tracking; CAS import; benchmark against Nifty 50; family view | Page read. Kuvera's own dashboard layout could not be confirmed |
| [Tickertape portfolio](https://www.tickertape.in/blog/now-analyse-mutual-funds-on-tickertape) | Holdings with their weight, top gainers and losers, CSV export | Search summary |
| [Paytm Money dashboard](https://www.paytmmoney.com/blog/analyse-mutual-fund-portfolio-paytm-money/) | Total value, allocation by fund house or by kind, absolute and per cent return per group | Search summary |
| [AMFI: consolidated account statement](https://www.amfiindia.com/investor-corner/investor-center/cas.html) | What a statement lists: purchase, redemption, switch, SIP, SWP, STP, dividend payout or reinvestment, bonus, merger | Search summary |
| ET Money, Moneycontrol | Searched; no feature page could be read, so nothing here relies on them | Not verified |

Taken together the list of "what an investor expects" is: invested, current value, absolute and per cent profit or loss, today's
move, XIRR (with a clear sense of what it means), returns over the usual periods, comparison with the Nifty 50, how the money is
split (kind, fund house, plan, size, sector), the SIPs, every transaction with a way to filter and export it, the booked and
unbooked gains by short and long term, and who in the family holds what.

## 2. The standard measures and how each is computed here

All functions are in `packages/core/src` (`return-profile.ts`, `period-pl.ts`, `portfolio-performance.ts`, `ledger-rows.ts`,
`benchmark.ts`, `invest-overview.ts`, `perf-inputs.ts`), each with tests in `packages/core/test`.

- **Absolute return**: value over cost, less one. Profit or loss in rupees is value less the money put in (the cost of the units
  still held). Booked gains come from the sales on statements, oldest units sold first, split short and long term by the
  holding period in Settings (equity funds only).
- **XIRR (money-weighted return)**: the existing `xirr.ts`: the one yearly rate that makes every dated flow and today's value
  net to zero. It answers "what did my money earn, given when I put it in". It is withheld until `funds.annualiseAfterMonths`.
- **Time-weighted return**: the portfolio is valued on common dates (month ends, the start of each period, every Sunday of the
  latest weeks and today). Each stretch between two dates has a return worked out by the Modified Dietz method (gain over the
  start value plus each cash flow for the part of the stretch it was invested). Stretches are chained into an index starting at
  100. It answers "how did the funds do, whatever the dates I added money". A fund's own price (NAV) is such an index already.
- **Trailing returns** (1W, 1M, 3M, 6M, this calendar year, this financial year, 1Y, 3Y, 5Y, all): the index (or the price) on
  the last day against the same on the day the period began. Under `annualiseAfterMonths` months the plain change is shown, from
  there the rate per year; a period the history does not reach back to is a dash.
- **Calendar-year and financial-year returns, month grid**: the last point of each month against the last point of the month
  before; a year is the months joined. The grid has a column per month (January to December or April to March) and a total.
  A month that is not over, or a year with fewer than twelve months, is marked.
- **Profit and loss by week, month, quarter, financial year, calendar year**: the sum of the rupee gains of the stretches inside
  the period (change in value less net money put in) and their chained return. Quarters follow the financial year
  (Q1 is April to June). A deposit is not profit and a withdrawal is not loss. Compare modes: latest period against the one
  before, person against person, fund against fund (the largest `funds.compareFunds`).
- **Drawdown**: the fall below the previous highest point of the time-weighted index (or of a fund's price), the deepest fall
  with its dates, whether it recovered, and where the line stands now.
- **Rolling returns**: for each month end, the return over the window ending there (1 and 3 years by default, per year), with
  lowest, median, highest and the share of windows above zero. Summarised only when `funds.rollingMinWindows` windows exist.
- **Volatility, Sharpe, Sortino**: from the last `funds.riskMonths` monthly returns (at least `funds.riskMinMonths`): sample
  standard deviation times the square root of twelve; Sharpe is the yearly return above the risk-free rate over volatility;
  Sortino counts only the shortfall below the risk-free rate. The risk-free rate is an assumption (`funds.riskFreeRate`) and
  the page says so.
- **Benchmark**: the same periods for an index fund's price, the difference in points, and a "same money, same days" what-if:
  every purchase put into the index fund at that day's price, every sale taken out, valued at the last price, with its XIRR.
- **SIP return against lumpsum**: the XIRR already treats each instalment on its own date; a fund with one purchase also gets
  the compound growth (CAGR). The what-if above is the fair test of a SIP against the index.
- **Tax-lot ageing**: each purchase still held is its own lot with its age, the date it turns long-term, its value and gain; the
  household view splits the value into age buckets (`funds.ageBucketsMonths`).
- **Realised gains per sale**: each sale line shows what it received, how old its units were, the gain booked and whether it was
  short or long term (mixed when it used both).

## 3. What the pages show

Investments (tabs): **Overview**, **Performance**, **Funds**, **Transactions**, **Breakdown**, **Update funds**, **Match funds**.

- Overview: a hero (current value, profit or loss in rupees and per cent, today, a ring of "your money against growth", the value
  against money put in over time, invested, XIRR, gains booked by selling, total gain, SIP a month, long-term share, statements
  against estimates; a plain statement that funds have no maturity value and a clearly labelled projection from the pace
  forecast), then value and money put in, returns over the usual periods against the benchmark, goal by goal, the split by kind,
  movers, the next monthly investments and the people side by side.
- Performance: the two kinds of return in one line each; returns by period (table and bars) with the benchmark; profit and loss by
  week, month, quarter, financial year or calendar year with a chart (green and red bars, running total line) and the three
  comparisons; month grid with best and worst month and year; growth of 100 against the benchmark; drawdown; risk; rolling
  returns; the what-if; value and money put in with the range switch; money put in each month; value by person; the pace forecast.
- Funds: one compact line per fund (about 47 px), grouped by person, goal, kind or fund house with totals per group and for
  everything, search, sort, CSV export; Edit on every row opens a side panel (units, amount invested, SIP amount and
  running/stopped, start date, goal, name, sold or closed, plan, exit load), with Add a fund and Add a transaction panels.
- Transactions: every line of every fund with type, units, price, amount, units held after, the fund and person, filters by
  type and by calendar or financial year, search, sort, export, a page at a time.
- Breakdown: person against person (including the last year's return), kinds, houses, funds, Direct against Regular, age of the
  units, concentration, gain or loss by fund, long-term share, SIPs, gains booked by selling by financial year.
- The fund page: headline row, then tabs **Overview** (figures and graphs), **Returns** (the fund's price return by period against
  the benchmark, growth of 100, month grid, drawdown, risk, rolling returns), **Transactions** (the full ledger with running
  cost and value), **Lots and gains** (units still held with age, cost, value, gain and long-term date; each sale with the gain
  it booked; the SIP calendar), **Records** (details, recorded values, activity).

## 4. The benchmark: what exists and what had to be added

- AMFI's daily file (`NAVAll.txt`) lists index funds and ETFs, and mfapi.in serves the full price history of any scheme code. On
  26 Oct 2026 scheme **120716, UTI Nifty 50 Index Fund, Direct Plan, Growth** was in the file and mfapi returned 3,398 prices from
  2 Jan 2013 to 23 Oct 2026. BSE Sensex ETFs are there too (for example 139581, 151585, 152097), so the proxy can be changed.
- `mf_navs` and the daily job only kept prices for funds the household holds. The job now also fetches the benchmark scheme
  named in the saved configuration (`funds.benchmarkCode`, default `120716`, empty to switch the comparison off), with the same
  one-time history back-fill. No migration is needed: `mf_navs` holds any scheme in `amfi_schemes`.
- Until the job has run, the pages say no benchmark is loaded and leave the benchmark columns out. Everywhere it is shown it is
  labelled a proxy: it is a fund that follows the Nifty 50, with that fund's small costs and tracking difference, not the index.
- The public sample draws its own invented index fund from the same recipe as the sample funds.

## 5. What we cannot show, and why

- **Category average and rank**: AMFI does not publish category returns in the free price files; they come from paid data
  providers. Peer funds are not in `mf_navs` either (only held funds and the benchmark). Left out, and the pages say so.
- **Expense ratio and the rupee cost of a Regular plan**: AMFI publishes the total expense ratio as a separate monthly file; it
  is not read yet, so the Direct and Regular split shows the shares and explains the commission, not a rupee figure.
- **Asset allocation inside the funds (market cap, sector, top holdings, overlap)**: needs each fund's monthly portfolio
  disclosure, which is not in the price data. The split by kind of fund (from the AMFI category) is shown instead.
- **Time-weighted history before the statements begin**: where a fund has no statement, its cash flows are worked out from the
  start date and SIP plan. Every figure that uses them is marked estimated, and the share of value that rests on them is stated.
  Estimated SIP lines (source `estimate`) are tagged "est." in the ledger and never counted as statement lines.
- **Weekly profit and loss further back than `funds.weeksShown`**: older history is valued month by month, so it cannot be cut
  into weeks.
- **Maturity value**: mutual funds have no maturity. The hero says so and shows a projection (pace forecast), labelled as one.
- **Sharpe and Sortino with a short history**: withheld until `funds.riskMinMonths` months exist.

## 6. Settings for the new figures

All in the saved configuration under `funds`, with built-in defaults in `packages/core/src/config.ts` and the same validation
as the older keys: `riskFreeRate`, `riskMonths`, `riskMinMonths`, `rollingYears`, `rollingMinWindows`, `benchmarkCode`,
`projectionYears`, `projectionCap`, `projectionSpread`, `ageBucketsMonths`, `ledgerPageSize`, `upcomingSips`, `moversShown`,
`weeksShown`, `plRows`, `compareFunds`. The Settings page has no form for them yet (it belongs to other work in progress); they
can be saved in the configuration table and the pages follow.
