# Family Wealth OS: interface research and design decisions (26 Oct 2026)

Who uses it: one person who runs the money of a family of four (Rupash, Ragini, Advika, Viraj): about 100 records across 12
banks, 25 fund folios, 4 owners (two are minors held under a guardian). Needs: read the picture in seconds, always know whose
money it is, update a whole bank in one place, and have the app do the rest automatically.

## What the research says (sources are in the session notes; findings only)

| Question | Finding | Decision |
|---|---|---|
| How do good net-worth apps show a family? | Monarch sets the **owner on each account** and offers an owner filter on Accounts, Reports and Cash Flow only (not on Budgets or Goals). Kubera tags every asset with its owner and breaks the total down by owner on request. Kuvera and INDmoney offer one family view with a switch between members. Snowball builds a "My Net Worth" composite over several portfolios. | One **person switcher** (Everyone / Rupash / Ragini / Advika / Viraj) at the top of every wealth screen; owner shown on every row. |
| How should ownership look? | Colour alone fails for colour-blind users (WCAG 1.4.1). The Okabe-Ito palette is the usual safe categorical set; 3–5 categories is the sweet spot. | Each person gets a fixed colour **and** an initial in a circle **and** their name in lists. Same everywhere. |
| What goes on the first screen? | Net worth is the anchor; a 6–12 month trend matters more than today's figure; mixing time horizons confuses; progressive disclosure (summary first, detail on demand) lowers load; role-based views remove noise. | Home = one big number, a person strip, "what needs you" (max 5, ranked), trend, allocation. Everything else one click down. |
| How should tables behave for data entry? | Inline editing keeps context; numbers right-aligned; sticky header and identifier column; pagination or grouping beats endless scroll; reveal bulk actions only when needed; offer undo; risky edits behind a deliberate step. | Update screens are **grouped by bank**, inputs inline, numbers right-aligned, header sticky, one Save per bank, an Undo toast after saving. |
| Monthly update flow | Excel's own data form does not exist on the web; Tab/Enter order must match column order; paste maps to column order. | Tab moves down the "New value" column; paste a column from Excel; Enter moves to the next row. |
| Tax harvesting UX | Robo-advisors (Betterment, Wealthfront) run harvesting automatically with opt-in and show only the action and the benefit; they cannot see outside accounts. Indian tools stress the **use-it-or-lose-it ₹1.25 lakh per person per financial year** and the 31 March deadline. | Harvest is computed automatically per person per year; the page shows only "do this, gain this, by this date" plus a scheduled reminder. No inputs. |
| Where to park money | Small finance banks lead FD rates (about 8.0–8.25% in Oct 2026), large private banks 6.5–7.25%, public banks about 6.75%. Rates age fast; sources conflict. | Rates page with a "checked on" date and source per row; deposits above ₹5 lakh per bank per person flagged against the insurance limit. |

## Information architecture (5 sections instead of 15 menu items)

1. **Home**: net worth, person strip, needs-you list, trend, allocation.
2. **Accounts**: one card per **bank** (savings + FDs together), filter by person. "Update this bank" opens the bank screen.
3. **Investments**: funds grouped person → fund, with value, invested, gain, SIP and the harvest flag.
4. **Plan**: Can I retire now, goals, the dated execution plan (the PDF steps).
5. **Tax**: automatic harvest advice per person, FD interest per person (taxable vs exempt), filing papers.
Under "More": Bank email inbox, rates, emergency guide, import, settings.

## Monthly update (the screen the user lives on)

- `/monthly` is a **checklist of banks and fund houses** with a progress bar ("7 of 12 updated this month"). Banks with something out of date show an amber dot; a bank that already updated by email shows "Updated automatically" and needs no action.
- `/monthly/<bank>` is **one screen per bank**: every savings balance, every FD (confirm still running, or mark matured and say where the money went), notes. Values are pre-filled with today's estimate, so the usual action is **Confirm** (one click) or type a new number.
- Save once per bank. Returning to the checklist moves to the next bank.

## Automation, visible

Every figure carries a small source tag: **Email 25 Oct**, **Statement**, **Calculated**, **Estimate**, **You, 12 Oct**. The monthly checklist
only asks for what automation could not settle. Tax and harvest pages have no inputs.

## Visual rules

Large numbers, one accent colour, person colours reserved for people only, red only for real problems, plain words ("matures in 12 days"),
amounts in Indian grouping with a compact form (₹1.2 Cr) on cards, full on hover/tap.
