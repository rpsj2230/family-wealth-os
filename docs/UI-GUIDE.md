# UI guide: how every page is built

The portal is used by two busy people on a phone and a laptop. A page should answer one question, show the few figures that matter,
say where each figure came from, and make the next action obvious. Follow this when you add or change a page.

## The page pattern

1. `PageHead` (components/PageHead.tsx): title, one sentence of purpose, status pills, one or two actions. The main action is the
   only filled button (`btn primary`).
2. Optional KPI strip (`.kpis` / `.kpi` / `.kpi.main`): at most six tiles, the first one the headline. Home, Accounts and Deposits use the richer overview panel instead (see "Overview panels" below).
3. `Tabs` (components/Tabs.tsx) when a page has more than one job. Tabs are links (`?tab=`), so each view has an address and the back
   button works. Four tabs at most, named by what the person does ("Gain harvest", not "Module 1"). Investments has eight: six to read (Overview, Performance, Value by period, Funds, Transactions, Breakdown) and two for the work of keeping it current (Update funds, Match funds). They are different jobs and each is a link with its own address; the strip scrolls sideways on a phone. A fund's own page has five (Overview, Returns, Transactions, Lots and gains, Records).
4. Cards (`.card`, `.personcard` for a person's block, `.pickcard` in a `.cardgrid` for things to act on). One idea per card.
5. Detail the person does not need every time goes in `<details className="disclose">`.
6. `Meter` (components/Meter.tsx) for "used / planned / free" shares. `Sparkline`, `Donut`, `BarList`, `TrendChart` (components/charts.tsx,
   TrendChart.tsx) for charts: plain SVG, a text legend with amounts, never colour alone. Fund graphs (components/PlotChart.tsx, FundViz.tsx) add hover/touch/keyboard read-outs, a table view, the palette tokens `--viz-1..8` (light and dark) and a time-range switch that is a link (`?range=`), so the server draws every range. Label data as *statement* or *estimated*; draw nothing the data does not support. A figure that rests on cash flows worked out from a start date and SIP carries an **est.** tag (or one note when every row does); a benchmark is always called a *proxy*.

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
- **Dense lists**: a list of things the person scans (funds, transactions) is one compact line per item on a laptop (about 45-50 px), with the secondary facts in a slim second line at a small size and the full line on hover; on a phone each item becomes a small card. Layout follows the width of the card, not the screen (container queries in `components/invest/invest.css`), so it is right beside the sidebar too. Wide tables sit in a scroll container that never widens the page.
- **Edit in a side panel**: on lists of things the person changes (accounts, funds), every row has an **Edit** pill opening the same `Sheet` side panel (`components/Sheet.tsx`, `quickedit.css`) with only the few fields people change, a live "Changed: ..." line, problems in words, and "Saved" at once. The panel's logic (what changed, what is wrong, what to send) is a pure function in `apps/web/lib` with tests; add and edit use the same database functions as the monthly update, and row-level security still applies.
- **Group by**: a list that can be read several ways gets a *Group by* chip row (links, so the choice is in the address) with a heading row of totals per group and a grand total.
- **Colour**: a person has one colour everywhere (`personStyles`, `PersonBadge`); a bank has its brand colour (`BankBadge`).
- **Accessibility**: real headings in order, labels on inputs, `role="status"` / `role="alert"` on results, contrast from the CSS variables.
- **No hard-coded rules or numbers**: anything a person might change (rates, limits, days) is a Setting with a default in `packages/core/src/config.ts`.

## Suggest, do not hand back ("needs a look" is not allowed on its own)

When the app cannot be sure, it must not push the work back to the person with "Needs a look", "needs review" or "please check". It works out the most likely answer from the evidence it has, **says it as a concrete suggestion with the reason**, and asks the person to approve it, pick another answer or type the missing input. Then it applies the decision. Every such prompt has the same four parts, in this order, built with `suggestion({ found, suggest, why, options, recommended })` (`packages/core/src/suggestion.ts`):

1. **What I found** (`found`): one plain sentence with the facts (the scheme, folio last four digits, units and amount; the balance, bank and date).
2. **What I suggest, and why** (`suggest`, `why`): the action as a sentence and the evidence behind it ("Folio …3820 is not on file yet, but your fund "Axis Large Cap" has 3,047.333 units, which equal the statement's closing units"). With no evidence it says so ("I cannot tell which it is, so I am not guessing: please choose.") and offers no Approve button.
3. **Approve**: one button, "Approve: link folio …3820 to "Axis Large Cap"". Pressing it takes the suggestion; it is shown as approved with where it is applied, and can be changed.
4. **Other choices or input**: radio options (each fund told apart by folio and units, "A new fund", "Leave it alone for now"), a field where an answer needs a date ("Sold on", "Stopped from", filled with the date I would use), and a link where the person may need another page ("Add this person in Settings > People").

Rules:

- **Evidence ranks the suggestion; ties suggest nothing.** The strongest evidence that points to exactly one answer wins (for a fund statement folio: ISIN and folio, then ISIN with equal units, then the folios of one scheme together holding the units of one fund, then a name only one fund has). Two equally good answers are "I cannot tell".
- **Nothing happens until the person decides**, unless the suggestion is how things already go (a fund missing from a statement of everything held is suggested sold and starts ticked, as before). The answer is part of the same selection as the ticks and is applied by the same button; the server accepts only an answer the prompt offered.
- **Show what the answer would do.** Where an answer turns the item into an ordinary fund, the changes it would make are shown under it before Apply.
- **Remember the answer, never delete.** An approved folio-to-fund answer is written once (`fund_folio_links`), so the same question is not asked again; "leave it alone" writes nothing. Applying the same answers again changes nothing.
- **Plain words, same labels.** "Your decision" (a chip, warn tone), never a red "Needs a look". Keep the four labels ("What I found", "What I suggest") so every prompt reads the same.
- Where the prompt is a form with a default (an inbox balance, a history conflict), the default is the suggestion and says so ("(suggested)").

Where it is used: fund statement preview (`FundChanges.tsx`, `fund-review.ts`: folio that could be several funds, fund not on the statement, SIP that cannot be judged, folios of someone else), bank-email inbox (`inboxProposal` in `inbox-view.ts`), history import conflicts (`conflictProposal` in `lib/history-view.ts`), and funds with no price source (`suggestSchemes` and `schemeProposal` in `packages/ingest/src/scheme-suggest.ts` and `scheme-proposal.ts`, drawn by `components/invest/FundsWithoutPrice.tsx` on Investments > Match funds: ISIN is certain, an exact name with plan and option is very likely, a fitting name with a known plan is likely, anything else is "I cannot tell" with the best three and how they differ). Tests check the words (`fund-review.test.ts`, `suggestion.test.ts`, `inbox-view.test.ts`, `history-view.test.ts`) and the pages (`e2e/fundimport.spec.ts`).

## Where things live

- Shared components: `apps/web/components/`. Shared pure logic: `packages/core`. Database access: `packages/data` and `apps/web/lib`.
- Page-specific styles: put them in a CSS file next to your page (`app/(app)/<area>/<area>.css`) and import it from the page. Only add to
  `app/globals.css` for something used by several areas.
- Every behaviour change gets a unit test (vitest) and, for a page flow, a Playwright test against a `/demo/...` page with invented data.
- Never commit the workbook, keys, passwords or PANs; identifiers are last-4 only.

## Overview panels (Accounts, Deposits, Home)

The top of Accounts, Deposits and Home share one language, built from the pieces in `app/(app)/accounts/BankOverview.tsx` and `bankoverview.css`:

- a **hero**: the value in lakh/crore form (`.bv-big`) with the exact rupees beneath (`.bv-exact`), then signed **Delta** chips. Each chip has an arrow
  and a word ("Up", "Down", for screen readers) as well as the colour, and the shared **`Est`** mark ("est.", `components/Est.tsx`, with the explanation as its title) when it is worked out from rates, prices or a plan, not read from a statement. Use `Est` everywhere a figure is an estimate; do not invent another tag;
- a **journey track** (put in, now, at maturity) where there is something to earn;
- a **split bar** (`SplitBar`) whose legend carries the name, the amount and the share of every cut, so colour is never the only cue;
- a grid of small labelled **stats** (`Stat`), each linking to the page that explains it;
- person and NRE/NRO splits, and a **"How these figures are worked out"** disclosure.

Home (`app/(app)/dashboard/`) reuses these, adds `Signed` (an inline signed figure), `hm-tag` status words (Late, Soon, Note, OK, Watch) and `BarRow`, and
lays its cards out with a container query so a narrow page area (the sidebar takes a share of the window) gets one column, a wider one two and the widest three.
Home's top also has `Money` (five tiles in the Delta language: invested, current value, maturity value, profit, earned today), `Classes` (four small
cards, `.hm-class`, 4 then 2 then 1 columns by the width of the page area, each linking to its page) and `Periods` (profit by period: a table on a wide page, one
card per kind on a narrow one with each cell labelled by its period; the header row stays for screen readers; styles in `money.css`). Every gain cell is an arrow, a
word and the figure; money put in or paid out is a separate muted line; an empty cell says "nothing held". Period figures come from `packages/core/src/period-gains.ts`, with every start and end value built by the position engine (`packages/core/src/position.ts`): each holding is valued from the nearest record on or before the day (see "Period figures" below).
The signed-in page and `/demo/dashboard` both draw `HomeView` from a `HomeModel` (`lib/home.ts`), so the sample can never look different.

### Cash in another currency

A Cash figure is always the rupee total of all cash. Foreign-currency cash is listed beneath it, never instead of it: `ForeignCashLines` (`components/ForeignCash.tsx`) draws the balance in its own currency (`S$ 41,250`) and, in small muted type, the rupee value with the rate and its day. In a header (a bank or a person on Accounts) `ForeignCashInline` is one quiet line (`incl. S$ 41,250 ≈ ₹23.14 L`). Words and numbers come from `packages/core/src/foreign-cash.ts` (`foreignCash`, `sumForeignCash`, `datedForeignCash`, `foreignRupeeLine`); components never recompute a rate. Where a cash figure is built (`ClassCard.foreign`, `BankOverview.foreign`, `OverviewPerson.foreign`, `Totals.foreign`) the foreign part rides with it, so a new page that shows a Cash figure should show the same lines.

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
| Five money figures (invested, current value, maturity value, profit so far, earned today) and four small cards (deposits, funds, cash, others) that add up to net worth | Asked for by the family; the same two-line figures (big compact number, exact amount beneath) as the Accounts overview. The cards partition net worth, so nothing is counted twice. |
| Profit by period (last N days, month, quarter, financial year, last financial year, since the start), per kind and in total | Worked out from each holding's terms (`period-gains.ts`), not from snapshots, so a deposit or a withdrawal is never profit. Quarter and financial-year boundaries are calendar facts; last N days is the existing Settings value. The Deposits, Cash and Accounts "earned today", Reports interest by financial year and the Investments profit and loss take their figures from, or are tested to agree with, the same module. |
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
| Mutual funds: value, gain, XIRR, today, best and weakest, per person, whether a statement is on file | Question 10. The "est." mark shows a return worked out from the plan you entered, not from a statement. |
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

- Net worth on Home is the same figure as everywhere. A deposit whose maturity date has passed is counted nowhere (net worth, banks, deposits, the "I need money" ladder, the insured limit, reports, goals): its money went to a savings account or a new deposit, which are counted on their own. One maturing today still counts. The rule is `packages/core/src/deposit-state.ts` and `buildPortfolio` values such a deposit as matured, not confirmed. Home notes the amount under the banks card.
- Lists of deposits (Accounts, Monthly update, the Deposits register) show only running deposits and those that matured within `deposits.hideMaturedAfterDays` days and are not confirmed (with a muted amount, "matured, not counted" and a **Confirm matured** button). Confirmed or older ones are hidden behind a quiet line, "N older or confirmed matured deposits are hidden. Show matured" (`?matured=all`), so nothing is lost.
- A figure the app worked out from rates or prices carries the word "estimate". A change over a period is measured from the daily snapshots and includes money added or taken out.
- The thresholds on Home are Settings (Money rules, Reminders): how many days "last month" means, how far ahead Coming up looks, and the bank share that is flagged.
  The other windows reuse existing settings: maturity "soon" days, task and policy days, the "I need money" scenario days and the deposit-insurance limit.

## The "?" next to a figure

Every headline figure and derived number carries a small round **?** (`components/Why.tsx`). It opens a card (a sheet from the bottom on a phone) that says what the figure is, how it was worked out **with the actual numbers plugged in** (and the denominator of every percentage), which data it rests on with a basis chip and the dates it covers, and how complete that data is. The five data states are always a colour **and** a word: `statement`, `recorded`, `calculated`, `estimated`, `missing`; completeness is `Complete`, `Partly estimated`, `Estimated` or `Missing data`. Where a figure is shown rounded (₹8.04 L) the exact rupees are in the card and in a `title`.

How to add one:

1. Register the figure id in `FIGURES` (`packages/core/src/explain.ts`). The type of each page's `ExplainSet` then forces a builder to return an explainer for it.
2. Write the builder in `packages/core/src/explain-*.ts`. It takes the numbers and flags the page already has (ledger verdict, lots basis, flows estimated, freshness, as-of dates) and **never recomputes** a figure by its own rule; say plainly when data is missing or assumed and from/to which dates.
3. Put `<Why explain={ex['page.figure']} />` beside the figure, or wrap a heading in `<WhyHead why={...}><h2>..</h2></WhyHead>`. Shared tiles take an optional `why` (`Stat`, `Cell`, `Tile`).
4. Add the id to the checklist below. `apps/web/lib/explain-coverage.test.ts` fails when a registered id is not used by a page component, is missing from this list, or a component names an unregistered id; `packages/core/test/explain.test.ts` fails when a builder leaves a registered figure without a title, sentence, formula or completeness.

Wording rule: a percentage always names what it is a share of ("+18.7% on the ₹43.01 L put in", "16% of today's value is growth").

### Coverage checklist (page -> figures that have a "?")

| Page | Figures |
|---|---|
| Investments, headline (Overview) | `invest.value`, `invest.profit`, `invest.today`, `invest.ring`, `invest.moneyIn`, `invest.xirr`, `invest.booked`, `invest.totalGain`, `invest.sip`, `invest.longTerm`, `invest.statements`, `invest.projection` |
| Investments, Overview cards and Funds | `invest.dataCheck`, `invest.valueChart`, `invest.returns`, `invest.goals`, `invest.mix`, `invest.movers`, `invest.nextSips`, `invest.people`, `invest.fundsTable` |
| Investments, Performance | `invest.pl`, `invest.monthGrid`, `invest.growth100`, `invest.drawdown`, `invest.risk`, `invest.rolling`, `invest.whatIf`, `invest.chgValue`, `invest.chgChange`, `invest.chgNewMoney`, `invest.chgMarket`, `invest.contrib`, `invest.pace` |
| Investments, Breakdown | `invest.byKind`, `invest.byHouse`, `invest.byFund`, `invest.keyFigures`, `invest.plans`, `invest.ageing`, `invest.gainByFund`, `invest.longTermCard`, `invest.sipCard`, `invest.bookedCard` |
| A fund's page | `fund.value`, `fund.moneyIn`, `fund.profit`, `fund.today`, `fund.xirr`, `fund.sip`, `fund.units`, `fund.tax`, `fund.booked`, `fund.returns`, `fund.benchXirr`, `fund.longTerm`, `fund.fundReturn` |
| Investments, Value by period | `valuation.chart`, `valuation.table` |
| Home, hero | `home.netWorth`, `home.today`, `home.earnedFy`, `home.savedFy`, `home.ownMoney`, `home.profitSoFar`, `home.movement`, `home.verified` |
| Home, How is my money growing? | `home.earningRate`, `home.fundsXirr`, `home.depositsXirr`, `home.savingsRate`, `home.xirr` |
| Home, Also on this page | `home.free30`, `home.maturing90`, `home.insured`, `home.nreNro`, `home.goalsStat`, `home.needsStat` |
| Home, cards | `home.classDeposits`, `home.classFunds`, `home.classCash`, `home.classOthers`, `home.periods`, `home.changed`, `home.trend`, `home.growth`, `home.where`, `home.liquidity`, `home.banks`, `home.deposits`, `home.funds`, `home.goals`, `home.risks` |
| Accounts | `accounts.total`, `accounts.profit`, `accounts.today`, `accounts.journey`, `accounts.where`, `accounts.deposits`, `accounts.cash`, `accounts.toEarn`, `accounts.soon`, `accounts.growth`, `accounts.fdXirr`, `accounts.savingsRate`, `accounts.interestFy`, `accounts.avgRate`, `accounts.largestBank`, `accounts.cover`, `accounts.updated`, `accounts.people`, `accounts.types`, `accounts.grand` |
| Deposits | `deposits.total`, `deposits.profit`, `deposits.today`, `deposits.journey`, `deposits.banks`, `deposits.ladder`, `deposits.invested`, `deposits.maturity`, `deposits.toEarn`, `deposits.next`, `deposits.soon`, `deposits.toConfirm`, `deposits.xirr`, `deposits.interestFy`, `deposits.avgRate`, `deposits.largest`, `deposits.cover`, `deposits.people`, `deposits.types` |
| Cash | `cash.total`, `cash.sinceLast`, `cash.today`, `cash.earns`, `cash.banks`, `cash.interestYear`, `cash.largestBalance`, `cash.largestBank`, `cash.stale`, `cash.people`, `cash.types` |
| Reports | `reports.fdCount`, `reports.fdPrincipal`, `reports.fdMaturity`, `reports.fdInterest`, `reports.fdRate`, `reports.fdNext`, `reports.fundCount`, `reports.fundInvested`, `reports.fundValue`, `reports.fundGain`, `reports.fundXirr`, `reports.fundSip`, `reports.table` (a general note; each table also has its own "?" built from the table itself) |
| Tax | `tax.allowance`, `tax.sell`, `tax.losses`, `tax.costs`, `tax.refunds`, `tax.simulator` |
| Monthly update | `monthly.status`, `monthly.freshness` |
| New money | `newmoney.options`, `newmoney.better`, `newmoney.room` |
| Rates | `rates.freshness`, `rates.best` |
| A fixed deposit's page | `fd.value`, `fd.profit`, `fd.invested`, `fd.maturity`, `fd.toCome`, `fd.interestFy`, `fd.afterTax`, `fd.insured` |
| A savings account's page | `savings.value`, `savings.today`, `savings.balance`, `savings.rate`, `savings.interestFy`, `savings.vsDeposits` |

Not yet covered (no "?" on these pages): Goals, I need money (Raise), Can I retire now, Lent, policies and property (Others), the Tax filing papers, Settings, the Import pages, the AI cost page, the monthly grid's per-row estimates and the per-bank pages. They show the same figures as the covered pages in places (net worth, deposit values) but their own derived numbers have no explainer yet.

## Period figures

One function, `positionGains` (`packages/core/src/position.ts`), gives every period figure: the Home tiles and table, the daily summary e-mail and the WhatsApp text, and the Value by period table (via the same `fundPeriod` kernel). Rules for a page that shows one:

- Say where the period begins (`sinceWords`: "since 28 Sep 2026", or "data starts 3 Mar 2025" only when no record exists before the start) and how many holdings it rests on (`coverageWords`: "86 of 100 holdings had a value then").
- Show a gain as earnings (interest, price and exchange-rate moves), and the change in net worth separately in quieter type: money added or taken out is never a gain.
- The "?" names the record dates the first day is built from (`HeadlineTile.startFrom`) and whether holdings were moved forward from an earlier record; a figure resting on a rate, a price move, a plan or an assumed growth carries the shared `Est` mark.
- A value for "no record" is "no data", never zero.
- A fund is worth units times the price of the day, from the ledger, else from units rebuilt from its plan (`packages/core/src/fund-plan.ts`: start date, amount invested, SIP amount and changes; each instalment at the price of its day or the next priced day), and only last of all from a value on file moved with the price (basis "sheet"/"nav_scaled", "last resort"). `fundsOf` is the one place Home's period figures and Investments > Value by period read the funds from, and what a monthly value, a counted unit count or net worth's figure differs from the plan by is carried apart (`unexplained`) and never counted as profit. While funds without a transaction ledger exceed the Settings threshold, the small note under the period tiles (`fundLedgerNote`) says the gains are approximate and links to Import > Fund statement. Prices of the schemes of such funds are read from the fund's start (kept in memory, `packages/data/src/nav-history.ts`); a probe of a day that is the edge of no period needs all the prices (`allPrices`).
- Points on the net worth line that were worked out afterwards from the history are marked "rebuilt from history" (`snapshots.source = 'rebuilt'`); a point recorded on the day is never replaced by one.
