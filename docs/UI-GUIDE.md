# UI guide: how every page is built

The portal is used by two busy people on a phone and a laptop. A page should answer one question, show the few figures that matter,
say where each figure came from, and make the next action obvious. Follow this when you add or change a page.

## The page pattern

1. `PageHead` (components/PageHead.tsx): title, one sentence of purpose, status pills, one or two actions. The main action is the
   only filled button (`btn primary`).
2. Optional KPI strip (`.kpis` / `.kpi` / `.kpi.main`): at most six tiles, the first one the headline. See the dashboard.
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
