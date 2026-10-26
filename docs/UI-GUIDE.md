# UI guide: how every page is built

The portal is used by two busy people on a phone and a laptop. A page should answer one question, show the few figures that matter,
say where each figure came from, and make the next action obvious. Follow this when you add or change a page.

## The page pattern

1. `PageHead` (components/PageHead.tsx): title, one sentence of purpose, status pills, one or two actions. The main action is the
   only filled button (`btn primary`).
2. Optional KPI strip (`.kpis` / `.kpi` / `.kpi.main`): at most six tiles, the first one the headline. See the dashboard.
3. `Tabs` (components/Tabs.tsx) when a page has more than one job. Tabs are links (`?tab=`), so each view has an address and the back
   button works. Four tabs at most, named by what the person does ("Gain harvest", not "Module 1"). Investments has seven: five to read (Overview, Performance, Funds, Transactions, Breakdown) and two for the work of keeping it current (Update funds, Match funds). They are different jobs and each is a link with its own address; the strip scrolls sideways on a phone. A fund's own page has five (Overview, Returns, Transactions, Lots and gains, Records).
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

## Where things live

- Shared components: `apps/web/components/`. Shared pure logic: `packages/core`. Database access: `packages/data` and `apps/web/lib`.
- Page-specific styles: put them in a CSS file next to your page (`app/(app)/<area>/<area>.css`) and import it from the page. Only add to
  `app/globals.css` for something used by several areas.
- Every behaviour change gets a unit test (vitest) and, for a page flow, a Playwright test against a `/demo/...` page with invented data.
- Never commit the workbook, keys, passwords or PANs; identifiers are last-4 only.
