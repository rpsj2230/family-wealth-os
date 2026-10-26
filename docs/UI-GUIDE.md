# UI guide: how every page is built

The portal is used by two busy people on a phone and a laptop. A page should answer one question, show the few figures that matter,
say where each figure came from, and make the next action obvious. Follow this when you add or change a page.

## The page pattern

1. `PageHead` (components/PageHead.tsx): title, one sentence of purpose, status pills, one or two actions. The main action is the
   only filled button (`btn primary`).
2. Optional KPI strip (`.kpis` / `.kpi` / `.kpi.main`): at most six tiles, the first one the headline. Home, Accounts and Deposits use the richer overview panel instead (see "Overview panels" below).
3. `Tabs` (components/Tabs.tsx) when a page has more than one job. Tabs are links (`?tab=`), so each view has an address and the back
   button works. Four tabs at most, named by what the person does ("Gain harvest", not "Module 1"). Investments has five, one more because statistics (Breakdown) and graphs (Growth) are different jobs from entering and matching funds.
4. Cards (`.card`, `.personcard` for a person's block, `.pickcard` in a `.cardgrid` for things to act on). One idea per card.
5. Detail the person does not need every time goes in `<details className="disclose">`.
6. `Meter` (components/Meter.tsx) for "used / planned / free" shares. `Sparkline`, `Donut`, `BarList`, `TrendChart` (components/charts.tsx,
   TrendChart.tsx) for charts: plain SVG, a text legend with amounts, never colour alone. Fund graphs (components/PlotChart.tsx, FundViz.tsx) add hover/touch/keyboard read-outs, a table view, the palette tokens `--viz-1..8` (light and dark) and a time-range switch that is a link (`?range=`), so the server draws every range. Label data as *statement* or *estimated*; draw nothing the data does not support.

## Rules

- **Nothing to type that the app can know.** Prefer a default, a suggestion, or an import over a blank field.
- **Every figure says where it came from and when**: use `UpdatedCell` / `srcchip` (BankTable.tsx) or a sentence ("Read from jana.bank.in, 26 Oct").
- **One home for each job.** If a function exists on two pages, keep the better place and link from the other. Never leave a page that
  needs a thing without a link to where it is done.
- **Plain words.** No codes or jargon without a sentence. Amounts in rupees with Indian grouping (`formatInr`). Dates as `26 Oct 2026`.
- **Empty states explain and offer the next step** (`.empty`), never a bare "Nothing here".
- **Errors say what to do.** "Add a free Groq key in Settings > Bank emails and AI", not "Failed".
- **Lists** are wrapped in `ListingTools` (search, sort, filter, export) and link each row to its detail page.
- **Mobile first.** Tables use `className="tbl lines responsive"` with `data-label` on each `td`. No horizontal page scroll (e2e checks this).
- **Colour**: a person has one colour everywhere (`personStyles`, `PersonBadge`); a bank has its brand colour (`BankBadge`).
- **Accessibility**: real headings in order, labels on inputs, `role="status"` / `role="alert"` on results, contrast from the CSS variables.
- **No hard-coded rules or numbers**: anything a person might change (rates, limits, days) is a Setting with a default in `packages/core/src/config.ts`.

## Where things live

- Shared components: `apps/web/components/`. Shared pure logic: `packages/core`. Database access: `packages/data` and `apps/web/lib`.
- Page-specific styles: put them in a CSS file next to your page (`app/(app)/<area>/<area>.css`) and import it from the page. Only add to
  `app/globals.css` for something used by several areas.
- Every behaviour change gets a unit test (vitest) and, for a page flow, a Playwright test against a `/demo/...` page with invented data.
- Never commit the workbook, keys, passwords or PANs; identifiers are last-4 only.

## Overview panels (Accounts, Deposits, Home)

The top of Accounts, Deposits and Home share one language, built from the pieces in `app/(app)/accounts/BankOverview.tsx` and `bankoverview.css`:

- a **hero**: the value in lakh/crore form (`.bv-big`) with the exact rupees beneath (`.bv-exact`), then signed **Delta** chips. Each chip has an arrow
  and a word ("Up", "Down", for screen readers) as well as the colour, and an "estimate" tag when it is worked out from rates, not read from a statement;
- a **journey track** (put in, now, at maturity) where there is something to earn;
- a **split bar** (`SplitBar`) whose legend carries the name, the amount and the share of every cut, so colour is never the only cue;
- a grid of small labelled **stats** (`Stat`), each linking to the page that explains it;
- person and NRE/NRO splits, and a **"How these figures are worked out"** disclosure.

Home (`app/(app)/dashboard/`) reuses these, adds `Signed` (an inline signed figure), `hm-tag` status words (Late, Soon, Note, OK, Watch) and `BarRow`, and
lays its cards out with a container query so a narrow page area (the sidebar takes a share of the window) gets one column, a wider one two and the widest three.
The signed-in page and `/demo/dashboard` both draw `HomeView` from a `HomeModel` (`lib/home.ts`), so the sample can never look different.

## Dashboard research (Home)

Done before redesigning Home (26 Oct 2026). The aim was to learn what people want to see first on a wealth home page, then keep only what a two-person Indian
household will use, in an order that reads in a few seconds. Most of what is public about these products is marketing copy or third-party reviews; where a
source was only a summary, or a page could not be opened (Monarch's help page returned 403), the finding is marked as such and was used only as a
direction, never as a fact about the product.

### What was looked at

| Source | What it showed | Link |
|---|---|---|
| Kubera | One balance sheet of assets and liabilities, allocation breakdown, IRR, trend over time; budgeting deliberately absent. Vendor blog and reviews only. | https://www.kubera.com/blog/investment-dashboard, https://thecfoclub.com/tools/kubera-software-review/ |
| Empower (Personal Capital) | Dashboard of net worth, cash flow, investments and progress to retirement and emergency goals; "Investment Checkup" compares allocation with a target; retirement planner. Reviews. | https://www.nerdwallet.com/finance/learn/empower-personal-dashboard-budget-app-review, https://robberger.com/empower-review/ |
| Monarch | Net worth chart with period switch and hover for the daily change; cards for net worth, recurring (upcoming bills), investments, budget; cards can be hidden and reordered. From the changelog; the help page was not opened. | https://www.monarch.com/blog/net-worth-improvements-and-more, https://www.monarch.com/monarch-brand-refresh |
| Copilot | Net worth across stocks, crypto and property, investments with live performance estimates, recurring items kept apart from the "left to spend" figure. Vendor pages. No evidence of a "what changed" card was found. | https://help.copilot.money/en/articles/11157550-quick-start-guide |
| Wealthfront | A gauge of how likely goals are to be reached; Path projects net worth and the cost of scenarios. Reviews only. | https://www.financialsamurai.com/wealthfront-path-review-financial-planning-tool |
| Ghostfolio | Return for Today, week, month, year to date, 1Y, 5Y and Max; static risk analysis; dark mode, mobile first. Read from the project's README. | https://github.com/ghostfolio/ghostfolio |
| Sharesight | Performance report that separates capital gain, dividends and currency; diversity report against a target; contribution analysis (which holding added what); income report. | https://www.sharesight.com/investment-portfolio-performance/ |
| Snowball Analytics | Home shows value, total profit including income, forward passive income with yield, and IRR; a calendar of expected payments with two figures (a yearly run-rate and the next twelve months). | https://snowball-analytics.com/blog/snowball-analytics-overview |
| ProjectionLab | Net worth projections and a success probability for goals; forward looking. Reviews. | https://projectionlab.com/blog/getting-started-with-projectionlab |
| Zerodha Console | A back office, not a home page: holdings, realised and unrealised P&L by period, a P&L heat map, tax reports; it warns to cross-check against contract notes. | https://support.zerodha.com/category/console/reports/articles/what-is-console |
| INDmoney | Net worth across stocks, funds, bank accounts, FDs and NPS; a family view (one combined number, each member viewable alone, only data the member linked); allocation and benchmark analytics. | https://www.indmoney.com/networth, https://www.indmoney.com/networth/family-accounts |
| Kuvera | Allocation analysis, portfolio XIRR, goals (users report many), joint and individual accounts under one login. | https://apps.apple.com/app/id1329701793, https://kuvera.in/blog/?p=1635 |
| Groww | A switch between "active" and "lifetime" XIRR on the dashboard; a broker's guide lists invested, current value and upcoming SIPs as the fund dashboard items. | https://groww.in/updates/xirr-feature-update-groww |
| Google Finance | Portfolios (launched June 2026): one view of performance, asset allocation, concentration risk and the holdings behind the biggest gains and losses; value in real time with 1M / 6M / YTD ranges; "1 Day" and "Total" return. A market tool, not a household balance sheet; no net-worth figure. News coverage and Google's help page. | https://support.google.com/websearch/answer/11330383, https://www.neowin.net/news/google-finance-is-now-out-of-beta-with-improved-portfolio-tracking-and-a-new-android-app/ |
| Family-office reporting | Consolidate with ownership preserved and a valuation date on every figure; liquidity ("how much can be reached quickly"), concentration, obligations coming due, allocation against target; layered detail for different readers; trace each figure back to its source. Vendor and adviser material, not a standard. | https://www.asora.com/blog/top-7-family-office-reporting-best-practices, https://www.sage.com/en-us/blog/family-office-financial-reporting/, https://www.privatebank.citibank.com/ivc/docs/Consolidated-reporting-in-family-Offices.pdf |
| Dashboard UX | Total first, then breakdown, then trend, in modular blocks; progressive disclosure; a headline readable without scrolling or arithmetic. Practitioner guides, not research. | https://www.lazarev.agency/articles/financial-dashboard-design, https://lollypop.design/blog/2026/may/investment-dashboard-ux-design-guide/ |
| Emergency money in India | Three to six months of essential spending in accessible form; the per-depositor-per-bank insurance figure is quoted by every source. Blogs and bank marketing, no official page; the limit is a Setting here. | https://kuvera.in/blog/emergency-fund-guide-complete-guide-for-indians-with-examples-tips-faqs/ |

### The first-glance questions

Across all of them a person opening the page wants these answered, in this order:

1. **What are we worth?** One number, large, with the exact figure beneath.
2. **What changed?** Today, this month, this year, in rupees and per cent; the periods Ghostfolio, Monarch and Groww offer.
3. **Can I trust it?** Which part is verified and which is estimated, with dates (family-office reports state the valuation date of every line).
4. **What needs me?** A short, ranked list with counts, each line a link to where it is dealt with.
5. **What is coming?** Maturities, policy dates, tasks, repayments, the end of the financial year (Monarch's recurring card, Snowball's calendar, a family office's "obligations coming due").
6. **Where is it, and whose?** Allocation, per person, and the split that matters in India: bank, deposit, fund, property, NRE or NRO.
7. **How fast can I reach it?** Cash now, deposits as they mature, and what could be raised by selling or breaking (the family-office "liquidity" question, and the reason this app has "I need money").
8. **Are we on track?** Goals funded or not; a trend with a straight "if the pace holds" line, not a forecast.
9. **What could hurt?** The deposit-insurance limit, one bank holding too much, late repayments.
10. **How are the funds doing?** Value, gain, XIRR, today's move, best and weakest (Groww, Kuvera, INDmoney, Sharesight).

### What Home includes, and why

| On Home | Because |
|---|---|
| Hero: net worth, today / last 30 days / financial year, each with arrow and word | Questions 1 and 2. Periods follow Ghostfolio and Monarch. The financial year (1 April) is how Indian families and the tax rules count a year. |
| "How much is verified" split bar (confirmed recently, from deposit terms, older or unconfirmed) | Question 3. It reconciles to net worth: the same holdings are counted. Estimated SIP ledger lines are never treated as statement-backed. |
| Needs you, ranked: late, then dated, then housekeeping | Question 4. Replaces a flat list; each line carries its count and a link. Thresholds are Settings. |
| Coming up timeline (deposits grouped by day) | Question 5. Grouping stops twenty deposits maturing on one day from filling the list. |
| What changed: biggest moves by kind of holding and by person, from the daily snapshots | The monthly-digest idea, shown where it is read. It says plainly that money added or withdrawn is part of a move. |
| Net worth over time with 1M / 3M / 6M / 1Y / All as links, the change over the range and over the equal stretch before it | Question 8 and the comparison asked for. A link per range keeps an address and the back button working; the server draws it. |
| Money put in against growth, for banks and funds | Sharesight's and Snowball's separation of contribution from return. Only holdings with a recorded cost are included; property and shares say so. |
| Allocation (split bar, legend), whose money, NRE or NRO, currency | Question 6. NRE or NRO matters for an NRI household and is already computed for Accounts. |
| Liquidity: the ladder with nothing sold, then what could be in the bank by each window from Settings, at no cost and with sales and early breaks | Question 7. The windows are the "I need money" scenario days, so the two pages agree. |
| Banks and Deposits snapshots; deposit interest this financial year and over the next twelve months | Reuse of the Accounts and Deposits overviews (same functions). The forward figure follows Snowball's "next twelve months", limited to the days each deposit has left. |
| Mutual funds: value, gain, XIRR, today, best and weakest, per person, whether a statement is on file | Question 10. The "~" mark shows a return worked out from the plan you entered, not from a statement. |
| Goals with a word and a bar | Question 8. |
| What to watch: insurance limit, largest bank (threshold in Settings), largest kind of holding, late loans | Question 9. |

### Left out, and why

| Idea | Reason |
|---|---|
| Asset allocation against a target, rebalancing hints (Empower, Sharesight) | The app has no target allocation, and a household with property and deposits is not rebalanced like a portfolio. A target would be one more thing to type and keep right. Concentration is shown as a plain share instead. |
| Cash flow, budgets, spending categories (Monarch, Copilot, Empower) | The app does not read transactions and does not aim to be a budgeting tool; Kubera leaves them out for the same reason. |
| Credit score, liabilities and loan EMIs | Not recorded in the app. Showing them empty would mislead. |
| Upcoming SIP instalments | The SIP day of the month is not stored, only the monthly amount, so a date would be invented. The amount a month is on the funds card. |
| Policy premiums and cover amounts | Policies store the renewal and end dates and a free-text cover note, not a premium or a sum insured. The dates are on the timeline and in Needs you. |
| Income and dividends (Sharesight, Snowball) | Only deposit interest can be worked out exactly from the data (each deposit's own terms). Savings-account interest would be a guess and fund dividends are reinvested. It is shown for deposits only and says so. |
| Success probability, Monte Carlo (ProjectionLab, Wealthfront) | "Can I retire now?" already answers this with assumptions the family can see. Home links to it. |
| Benchmark comparison (Ghostfolio, Sharesight) | A benchmark needs a market index series the app does not collect; the funds page compares each fund with the household's own return. |
| A person filter on Home | Home is the household view; each page keeps its own filter, and the "Whose money" rows link to Accounts filtered to a person. A filter would make the headline disagree with the same figure on other pages. |
| P&L heat map (Zerodha) | Useful for traders; this household invests by SIP and holds deposits. |
| Customisable, reorderable cards (Monarch) | Two users, one layout. A fixed order is easier to learn and to explain on a phone call. |
| Draggable or animated charts | Plain SVG that prints and reads aloud is the rule (see the page pattern). |

### Standing decisions

- Net worth on Home is the same figure as everywhere. Where another page's own figure differs for a stated reason, Home says so: money in banks leaves out a deposit past its date that is
  still listed as running (it waits for confirmation) while net worth still counts it, so Home shows that amount in a note under the banks card.
- A figure the app worked out from rates or prices carries the word "estimate". A change over a period is measured from the daily snapshots and includes money added or taken out.
- The thresholds on Home are Settings (Money rules, Reminders): how many days "last month" means, how far ahead Coming up looks, and the bank share that is flagged.
  The other windows reuse existing settings: maturity "soon" days, task and policy days, the "I need money" scenario days and the deposit-insurance limit.
