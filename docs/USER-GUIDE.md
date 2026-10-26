# Family Wealth OS: user guide

For Rupash and Ragini. Everything here describes what the app does today. Items marked _(waiting)_ need something from you first (see `docs/NEEDS-FROM-YOU.md`).

## What the numbers mean

- **Verified** is the last balance you entered or an official statement showed, with its date.
- **Estimated today** is the verified figure moved forward: fixed deposits by their own interest terms, savings at an assumed rate, mutual funds by the latest published NAV, Singapore dollars by the latest exchange rate. Each figure is labelled _calculated_, _estimated_ or _carried forward_.
- An asset with no value is listed but never counted as zero. Insurance cover is never counted in net worth, and nor is a deposit marked as matured and unconfirmed. A deposit past its date that is still listed as running is counted at its maturity amount until you say where the money went; Accounts and Deposits leave it out of their bank figures and Home says so under the banks card.
- Money you have lent is shown as owed, not as cash.

## Home

The first page answers, from the top down:

1. **What are we worth?** The big number is net worth in lakhs and crores with the exact rupees under it. Beside it, **How much is verified** shows the share of that value that was recorded recently and confirmed, or worked out from a deposit's own terms (the rest is older, or imported and not yet confirmed). Beneath the number are three changes, each with an arrow and a word: **Today** (an estimate: interest earned since yesterday at each rate plus the move in fund prices), the **last 30 days** and **this financial year** (from 1 April). The last two compare today with the net worth saved each day, so money you added or took out is part of them. The 30 days is a setting.
2. **Needs you** lists what needs a person, late things first (matured deposits to confirm, loans past their date, overdue tasks and policy dates), then things with a date coming (deposits maturing soon, tasks and policies due, money above the deposit-insurance limit, bank e-mails to review), then housekeeping (balances out of date, holdings with no value). Every line says how many and links to where it is dealt with.
3. **Coming up** puts deposits (grouped by day), policy dates, tasks, repayments and the end of the financial year on one timeline. How far ahead it looks is a setting (120 days).
4. **What changed** shows the biggest moves since the comparison day, by kind of holding and by person. A move includes money you added, a deposit that matured and interest and price changes.
5. **Net worth over time**: choose 1M, 3M, 6M, 1Y or All (each is a link, so the back button works). It shows the change over that stretch and over the same length of time before it, a dotted line for "if the last year's pace continues" (a straight extension, not a forecast), and, for banks and funds, how much was put in against how much it has grown. Property, shares and money lent have no recorded cost and are left out of that split.
6. **Where the money is** by kind of holding, by person (each name links to Accounts for that person), and by NRE or NRO and currency when you have more than one.
7. **How fast can I get at it?** First what arrives with nothing sold (accounts now, then each deposit as it matures), then, for each window set under "When I need money", the most that could be in the bank at no cost and with sales and early breaks included, before tax and penalties. **I need money** shows the cost of each way.
8. **In banks**, **Fixed deposits** and **Mutual funds** are short versions of Accounts, Deposits and Investments and use the same figures. Deposits also show the interest added this financial year and what the running deposits add over the next 12 months if held to maturity. Funds show value, gain, annual return (XIRR), today's move, best and weakest, and a note on which funds have a statement on file (a **~** marks a return worked out from the plan you entered).
9. **Goals** and **What to watch** (deposit insurance, the largest bank, the largest kind of holding, late loans).

**How these figures are worked out** (under the top box) explains each figure and lists the latest recorded values. In Settings > Money rules > Reminders you can change what "this month" means, how far ahead Coming up looks, and the share at which a bank is flagged.

## Monthly routine (about 5 minutes)

1. Open **Monthly update**. The top box says which banks are up to date for the month, which are waiting for a value, and how each latest balance arrived (email, you, a statement, the imported sheet or a calculation).
2. Work down the banks that are waiting. Type the new balance and press Enter for the next one, or paste a column from Excel or your bank app into the first box. **Same** keeps one balance as it was; **Nothing changed at (bank)** does it for the whole bank. A note under a box tells you how far the new figure is from the last, and warns about a likely typing slip.
3. To change a rate, a note, a name or a deposit's terms while you are here, press **Edit** on that line (the same panel as on Accounts; see "Changing one account" below). Press **Save**. Nothing is stored until then, and **Discard** drops the lot. The dashboard and the history chart update.
4. Deposits are worked out from their terms and sit in a closed box under each bank; only a matured deposit needs you to say where the money went. Property, pension, shares and money lent are on the second tab, **Property, loans and other**.
5. Check **Bank emails** for balances read from your email that are waiting for you, and **Tasks** for anything the app has raised.

## Bank emails

Forward bank alerts to the Gmail label shown in Settings. A balance from the bank's own address that matches exactly one of your accounts is recorded by itself. Everything else waits under **Needs your review** with the reason in plain words ("it did not come from the bank's own address", "the amount is very different from the last value"). Choose the account and press **Apply**, or **Ignore** (you can put an ignored message back). **Recorded** lists what was taken in, **Skipped** lists what was set aside and why (not a balance email, older than what you have, ignored by you, reader problems), and **Automation** shows when the email reader, market data, daily summary and rate pages last did their work.

## Import

Open **Import**, press **Choose a file** and pick whatever you have: your Excel workbook (.xlsx), a fund statement (PDF), a fund app export (CSV) or a tax statement (Form 26AS or AIS). The page works out which one it is from the file's name and first lines (in your browser; nothing is uploaded yet) and shows the matching form with the file already attached. If it cannot tell, it asks "What is this file?"; you can also correct a wrong guess. Below the box there is a card for each kind if you prefer to choose yourself.

- **Excel workbook**: _Update order, names and links_ makes the screens follow your sheet (order, NRE or NRO, joint, which savings account each deposit belongs to, deposit numbers as last four digits, notes). It never changes a balance and is safe to repeat. _Import balances and deposits_ is for the first time or a new household: it shows a preview with checks against your own sheet and saves nothing until you press Import. The same file cannot be imported twice.
- **Fund statement**: a CAMS/KFintech/MF Central PDF. Choose whose it is (taken from the file name when possible) and type the password you chose when you requested it, usually your PAN in capitals; it is used once and never saved. Statements forwarded by email are read by themselves.
- **Fund app export (CSV)** (Kuvera layout: Date, Folio Number, Name of the Fund, Order, Units, NAV, Current Nav, Amount): choose all the files at once, one per person (the first name in the file name is pre-selected). Press **Preview** to see, per fund, whether it updates a fund you have or adds a new one, with units, amount invested and value; then **Import**. Folios of the same fund are combined; importing a file twice adds nothing twice; digital gold (no folio) is left out.
- **Tax statement**: Form 26AS or the AIS. The date of birth saved in Settings opens a protected PDF.

Each kind keeps its own page (open its card) with the last result and anything that needs a look.

## Cash, and the total on Accounts

**Cash** (the *Savings and cash* tile on Accounts opens it) is to savings what Deposits is to fixed deposits: the cash available today, what the balances are estimated to earn (a year, a month, a day), which bank holds how much with each bank's share and average rate, the balances that are out of date, the largest balance, the split by person and by NRE and NRO, and a register of every savings account with its rate, last recorded balance, value today and interest a year. The person filter narrows all of it. Interest is an estimate: balance times rate, less the tax at source set in Settings.

At the bottom of **Accounts** a **Total** shows invested or balance, what everything pays at maturity, and today's value, for the lines counted. It follows the person you choose and the search or column filters: type a bank name and the total becomes that bank's. It uses the same rule as the overview at the top, so the two always agree.

## Fixed deposits

**Deposits** has three tabs: Deposits (every deposit with its bank, owner, rate, maturity date and the amount at maturity), Maturities (what to confirm, what matures soon, a calendar) and Insurance cover. A matured deposit stays out of net worth until you say where the money went. The insured-limit view shows, per bank, each ownership name as written against the ₹5 lakh deposit insurance limit: Rupash, Ragini, Rupash & Ragini and Ragini & Rupash are four different names, each insured separately (so up to ₹20 lakh at one bank), and the order of the names matters. Set the second name of each joint account by pressing **Edit** on it, then **More details** (Joint account, Second name; the swap button reverses the order); until then a joint account is grouped under its first name.

**The overview at the top of Deposits** shows what the fixed deposits are worth today (current value), what you put in (invested) and what they pay at maturity, the profit so far in rupees and per cent, and an estimate of what they earned today (the difference between each deposit's value today and yesterday on its own rate). Below it: **which bank holds how much** (a ranked list with each bank's share, deposits, average rate and next maturity; the link beside it groups the list below by bank), **what matures year by year**, and the smaller figures: interest still to earn, next maturity, deposits maturing within the reminder window, deposits to confirm, the share held at the largest bank and the amount above the insured limit. The split by person and by NRE/NRO sits at the bottom. The person filter narrows the whole overview; the insured limit is always for the whole household.

## Mutual funds and goals

- **Investments** has seven tabs. **Overview** is the first screen: what the funds are worth, the profit or loss in rupees and per cent, today's move, the annual return (XIRR), what selling has booked, the SIP and the long-term share, with goal by goal, movers, the next monthly investments and the people side by side. **Performance** is how they have done over time (below). **Funds** lists every fund on one compact line (figures right-aligned, the units, start and kind in a slim second line) grouped by person, goal, kind of fund or fund house, with totals. **Transactions** is every purchase, instalment, switch, dividend and sale of every fund. **Breakdown** is the statistics page. **Update funds** is the monthly entry of units and prices. **Match funds** matches each fund in your sheet to the official scheme list once; you confirm the match. The old Growth address opens Performance. The person chips narrow every reading tab to one person; each person keeps one colour on every graph.
- **Goals** has one progress card per goal: how much of the cost is set aside today, how much the projection covers, the extra to put in each month, and the funds set aside for it. Add a goal with just a name; set a target and date later under *Edit this goal*. The second tab, *Money not set aside*, lists each holding with the share no goal claims, so you can set it aside in one step. A holding can be split across goals but never above 100%.

## Can I retire now?

Open **Retire**. The verdict stays at the top while you work in the tabs below it: _Your inputs_ (about you, spending and saving, market assumptions; Save keeps them), _Compare_ (three scenarios, retirement ages, the effect of common changes), _Range of outcomes_ and _Corpus and method_. The result is one of:

- **Meets the plan** under your assumptions,
- **Shortfall**, with the size of the gap and what would close it (spend less, retire later, save more),
- **Cannot assess**, with the missing item named.

It never says "safe". A range of outcomes (market ups and downs) is shown next to the single projection. The public sample at `/demo/retire` uses made-up numbers.

## Tax

- **Tax** (redemption simulator, under *How it works*): enter the lots of a fund and the amount to redeem. It shows first-in-first-out lots, short or long term, exit load, the allowance used, tax at source for non-residents and the refund expected on filing. The harvest suggestion never trades for you.
- **Tax filing papers** (`/tax/filing`): fixed-deposit interest per person and financial year (taxable for NRO, exempt for NRE, joint accounts flagged), an optional tax-at-source estimate at a rate you type, a CSV download and a checklist of documents. Capital-gains schedules _(waiting for the consolidated statements)_.
- Check every figure against your bank certificates, Form 26AS and the Annual Information Statement before filing. Tax rules are marked unverified until checked against the official source.

## Money lent and policies

**Lent, policies, property** has three tabs: Money lent (add a loan, record repayments, set an expected date), Policies (add a policy; renewal, end date, nominee, where the documents are) and Property and other (property, NPS, ULIP with their latest value and date). Renewals and end dates appear in the daily summary 45 days ahead.

## Daily summary

**Settings** turns the daily email on and adds up to five extra recipients. The email says plainly when no new bank balance has arrived, shows the date of every market input and never presents an estimate as a bank balance. **Share** gives a short version for WhatsApp.

## Family emergency guide

**Emergency** lists, per institution, who holds the account, the nominee, what the family does first and where documents are. A print view is included. A separate read-only role for trusted people exists in the database and can never see balances.

## Backups

Every night the database is exported, encrypted with a key only you hold and stored on the `backups` branch of the repository. Restore steps and the test restore are in `docs/runbooks/backup-and-restore.md`. Keep the private key somewhere other than this repository (for example a password manager and a printed copy in a safe).

## When something looks wrong

- A balance is far off: check its date. A stale value is flagged and carried forward.
- S$ looks different from your sheet: the sheet used ₹65; the app uses the latest market rate and shows the currency effect.
- The site shows an error: `/api/health` says whether the database is reachable.

## I need money

Open **I need money** (Home button or menu), type an amount, and choose whose money it is. The page shows, for each deadline
(today, 3 days, 14 days, and so on, set in Settings), the most you can have by then, what it costs, and exactly what to do:
cash in bank accounts (a balance is left in each, set in Settings), deposits that mature in time, deposits you could break early
(interest lost is estimated), mutual funds and shares (settlement days, exit load, tax with the non-resident withholding and refund),
money lent out, and property as a last resort. **Advanced: choose where to look** lets you leave a source out for one search;
**Settings, When I need money** sets the usual order, costs and delays. "Make these steps into reminders" turns a plan into tasks.

Limits: costs are estimates from what is recorded; where a fund's cost is not recorded the gain is assumed (Settings) and the plan says so.
Nothing is moved for you.

## Tax harvesting and refunds

**Tax** (tab *What to sell*) answers one question per person: which units to sell this year, and how many. Each person's block opens with
one sentence (for example "Asha can book ₹81,000 of tax-free gain this year"), a bar of the yearly free allowance (used / this plan /
still free) and a **Sell this** list: fund, the exact **units to sell** (plain digits with a Copy button, to type into the platform's sell screen),
what they are worth, the gain locked in tax-free, and plain checks: held over the long-term period (Settings, Tax rules), no exit load (or the load that
applies), within the free allowance, and whether the purchases come from your fund statement or are estimated from your SIP history.
**Show the working** under each fund lists the purchases the units come from, oldest first, with date, cost and gain per purchase, the long- and
short-term split, the costs, and the amount to put back afterwards. **Do not sell yet** lists funds with short-term units or an exit load still
running, with the date each turns ready. **Losses you can book** says in plain words which units would book a loss and whether it saves tax this
year. **On the platform** is a five-line checklist. A small footnote at the bottom gives the costs to expect (stamp duty, transaction tax, exit load).
Non-resident tax withheld is in the person's working and each harvest creates a
**Tax refunds to claim** record by itself (expected tax withheld and expected refund; tab *Refunds*). Update it as the sale happens, the return is filed
and the refund arrives; **Download as CSV** gives it to your adviser. NRO interest tax is handled on the filing papers because the refund
depends on your total Indian income. The app prepares figures; the return itself is filed on the income-tax portal using Form 26AS and the
Annual Information Statement, which the app cannot download for you.

## Fund statements (CAS) and exact harvesting

Ask CAMS/KFintech (or MF Central) for a **detailed** statement from the first investment to today, for each person, and forward the
e-mail to your `FWOS/Inbox` label. The inbox job opens it with the PAN saved in Settings, finds each fund by ISIN (or name and folio),
adds funds it does not know, stores every transaction and updates invested amount, first purchase date, SIP and value. You can also upload
the PDF under **Import** (type the PAN once to open it; it is not saved). From then on harvesting works from real purchase lots, oldest units
first, includes funds with a running SIP, and counts long-term gains you have already realised this year.

### SIP changes, estimated instalments and funds missing from a statement

- **How "Stopped" is decided.** A SIP is shown as stopped in three ways: you mark it stopped (or set its amount to zero) when updating the fund; the imported workbook has "(STOPPED)" in the fund's name; or a fund statement shows it: the last instalment on the statement is more than a number of days before the statement ends. That number is in Settings → Estimated balances ("A SIP is shown as stopped when no instalment has come for"), 45 days by default. The stop is dated from the day after that last instalment. A fund with no statement and no mark shows as running, with no latest instalment, because nothing says otherwise.

- **Changing a SIP.** When you raise, lower, stop or restart a SIP (Investments, update a fund), the change is written down with the date it takes effect (today unless you set a date). The instalments already made keep the amount that was in force on their day, so a new amount never rewrites the past. A stopped SIP adds no instalments after its stop date.
- **Assumed instalments are saved as estimates.** For a fund with counted units and a running SIP, the instalments assumed since the units were last counted (each at the price of its day) are kept in the transaction list, worded "Estimated SIP instalment, not yet on a statement", so lots, returns and graphs agree with the value shown. They are never shown as paid on the SIP calendar. As soon as a statement or an entry covers a date, the estimates up to it are removed and the real lines take their place; the daily job keeps the rest up to date.
- **A fund missing from a complete fund statement is treated as sold.** When a full fund statement (PDF) for a person is imported, any fund of theirs that is not on it is closed, its units set to zero, its SIP stopped and its value set to zero on the statement date. The import report lists each one ("assumed sold") so you can correct a mistake. This is not done for a file of some transactions (CSV), when a fund on the statement could not be matched, or for a fund started or updated after the statement ended.

### Which AI reads the pages and e-mails

Settings → Bank e-mails and AI offers **Anthropic (Claude Haiku)**, OpenRouter, Groq and Google Gemini. Claude Haiku is the most reliable: it answers every time and costs a fraction of a cent for a rate page, so a few dollars of credit lasts years at this volume. Create a key at console.anthropic.com, add a little credit, paste the key and press **Test**. The free providers cost nothing but some of their models are slow or restricted; the reader remembers which model worked and asks it first.

## Who can open the handbook, and when

Settings → Emergency information: the read-only family login can open the handbook always, only after nobody from the household has signed
in for a number of days, or only when you release it. Release or lock it again with one button. Members always have access.

## Returns, capital gains and the summary

- **Investments** shows the annual return (XIRR) per fund, per person and for the household. Where a fund has a statement (or imported transactions) the figure comes from the real transactions; for the others it is estimated from the start date and SIP and is marked **estimated** (a `~`, or an orange *estimated* tag). Nothing is drawn from data the app does not have: a graph that needs a statement says so instead.
- **Two kinds of return.** *Time-weighted* shows how the funds themselves did, whatever the dates you put money in (the period tables and the month grid). *Money-weighted (XIRR)* shows what your own money earned, given when each rupee went in (the headline). A fund's published price return ignores your timing too.
- **Performance** (Investments): *Return over time* for 1 week, 1, 3 and 6 months, this year, this financial year, 1, 3 and 5 years and since the start (under a year the plain change, from a year the rate per year), as a table and bars, with the profit in rupees and the **benchmark** beside it. The benchmark is an index fund that follows the Nifty 50, a stand-in for the index (it carries the fund's small costs); until the daily job has fetched its prices the columns are left out. *Profit and loss by period*: switch between week, month, quarter, financial year (April to March) and calendar year; green and red bars with the running total as a line, and a table with rupees, per cent, money added and value at the end. Money you put in or take out is never counted as profit. *Compare* this period with the one before, one person with another, or fund with fund. Periods that rest on funds with no statement are marked **est.** *Month by month*: a grid of each month's return with the year's total (financial or calendar years), the best and worst month and year. *Growth of 100 against the benchmark*, *fall from the highest point* (drawdown), *risk* (volatility, Sharpe and Sortino, with the risk-free rate you can change), *rolling returns* (what any holding period would have earned), *the same money in the index fund* (your actual purchases put into the index fund on the same days), then value against money put in with the time-range switch, money put in each month, value by person and "If you carry on like this". Mutual funds have no maturity value, so the page shows a projection and says so. Hover, touch or the arrow keys read out the figures, and every graph has "Show the figures as a table".
- **Funds** (Investments): press **Edit** on a fund for a side panel with the few things people change (units held, amount invested, SIP amount and whether it is stopped, start date, goal, name, sold or closed; plan and exit load under More details). It says what changed, explains a wrong entry in words and shows "Saved" at once. **Add a fund** and **Add a transaction** open the same kind of panel. *Group by* person, goal, kind of fund or fund house; the goal view adds a goal-by-goal summary and puts funds with no goal under "No goal". Search, sort by any column and Export CSV work on the page.
- **Transactions** (Investments): every line of every fund with its type, units, price, amount, units held after it, the fund and the person. Filter by type (SIP, one-off, sales, switches, dividends and bonus) and by calendar or financial year, search, sort and export; long ledgers show a page at a time. A line marked **est.** is an assumed instalment that is not on a statement yet.
- **Breakdown** (Investments): *By person* side by side (including the return of the last year); *Key figures* (money put in, value, gain on the units still held, XIRR, best and weakest fund overall and today, funds and folios as last four digits); the money split *by kind of fund* (large, mid, small, flexi, index, ELSS, hybrid, debt, gold, international; read from the official category once a fund is matched, otherwise guessed from the name and marked **?**), *by fund house* and *by fund*, with how concentrated it is (the largest funds' share and "spread like N equal funds"); *Direct and Regular plans*; *how old the units are*; *gain or loss by fund* as bars either side of zero; *how much is long-term already* (equity-oriented funds only, using the long-term period in Settings, Tax rules, from the real purchases or, marked estimated, from the SIP plan and published prices, with the date the next units turn long-term); *monthly investments (SIP)* (total each month, running and stopped, paid so far, longest running, next instalment); and *gains already booked by selling* split short and long term by financial year (gains only: the tax is on Tax filing papers).
- **A fund's own page** (open a fund from Investments) has a headline row (value, invested, profit or loss, XIRR, compound growth or gains booked, SIP) and five tabs. *Overview*: the figures and graphs (the price with a dot at each purchase and your average cost line, value against money put in, units over time, money put in each month, a month-by-month SIP calendar and how much is long-term; the range switch applies). *Returns*: the fund's own price return over each period against the benchmark, growth of 100, the month grid, fall from the highest price, risk and rolling returns. The category average and the expense ratio are not shown: the free price data does not carry them. *Transactions*: every line with units, price, amount, units held, the cost and value of the units held after it, and for a purchase what it is worth today; filters, search, sort and export. *Lots and gains*: each purchase still held with its age, cost, value, gain and the date it turns long-term; each sale with the gain it booked and whether it was short or long term; the SIP calendar. *Records*: details, the values you recorded and the activity log. Edit this fund opens the side panel.
- The numbers behind these pages (how many months of history before an annual figure is drawn, how many funds make "concentration", how many months the calendar and monthly bars show, how many slices a ring has) are in the saved configuration with built-in defaults; the long-term period is the equity holding period of Tax rules.
- **Tax filing papers** lists every fund sale of the year, short and long term, with the estimated tax, and downloads the schedule 112A rows per person. Compare the column order with the portal's current template before uploading. Units bought before 1 February 2018 need the 31 January 2018 value per unit, which the file leaves blank. Each person's FD interest can be compared with the tax shown in Form 26AS.
- **Lent, policies, property** also shows property, NPS, ULIP and foreign-currency balances with the exchange rate used.
- The daily summary now also carries the tax-harvest deadline and amounts, refunds still to claim, and on the first of each month a month-in-review line per person.

## Changing the order

Accounts → **Manage** → **Change the order** lists your banks and, inside each, its rows. Drag a bank or a row, or use the arrow buttons (they work from the keyboard), then press **Save this order**. Accounts and the monthly update follow the new order from then on. Uploading your workbook again under Import (_Update order, names and links_) sets the order back to the sheet's.

## Form 26AS and the AIS

Tax filing papers → "What the tax department holds". Download **Form 26AS** from TRACES (PDF, text or HTML; the PDF opens with your date of birth, which the app already has from Settings) and the **Annual Information Statement** from the income-tax e-filing portal (PDF or JSON), then upload them there, or e-mail them to your inbox label and they are read by themselves. The app lists each deductor and the tax credited, then compares it with the tax it expected on your deposit interest and fund sales, and compares the AIS's interest, dividends and fund sales with your own records. Differences are shown for you to check; nothing is changed automatically. The department does not publish the exact file layouts, so the reader looks for the parts every version has; if it cannot read a file, forward it by e-mail and an AI reader (the key in Settings) tries, marking the result "read by AI: check the figures".

## Getting your fund statements by e-mail

1. Go to the CAMS or KFintech statement page (or MF Central) and request a **Consolidated Account Statement**: type **Detailed**, period **from the first investment to today**, include folios with zero balance, to the Gmail address the app reads.
2. When the form asks for a password, **type your PAN in capital letters** (the same one saved in Settings). The password is whatever you choose on that form.
3. In Gmail, make a filter: from `camsonline.com`, `kfintech.com`, `mfcentral.com`, `cdslindia.com` or `nsdl.com` and has an attachment, then apply the label `FWOS/Inbox`. Statements are then imported by themselves, now and when the registrars send you monthly ones.

## The overview at the top of Accounts

The panel above the bank list (on Banks and on Manage) answers "how much is in the banks and how is it doing?". The large figure is today's value of everything counted; beneath it are **Profit so far** (today's value less the amount invested, in rupees and per cent) and **Earned today** (what the holdings earned since yesterday, marked *estimate*: a deposit from its own rate and dates, a savings account from its balance and rate, money held by others and foreign balances earn nothing here). The track shows **Invested**, **Current value** and **Maturity value** and how much of the interest is already earned. **Where the money sits** splits savings and cash, fixed deposits and other holdings. The figures below add the average deposit rate, interest still to earn, the next maturity, what matures within the number of days set in Settings (reminders), the largest bank's share, the amount above the insurance limit (also from Settings), banks updated this month and how many need you; then the split by person and by NRE and NRO. Choosing a person changes every figure to that person's. Invested is the deposit amounts plus the last balance recorded for each account; a deposit past its date is left out until you confirm it, and foreign-currency balances are counted at today's rupee value with no gain or loss.

## Changing one account

On **Accounts** (and on the Monthly update, and on an account's own page) press **Edit** on any line. A panel opens on the side with only what people change: the name, the balance now (with its date), the interest rate, the type (NRE, NRO and so on), the status and a note; for a deposit the rate, maturity date, amount invested and amount at maturity. Rare things (last four digits, joint account and second name, person, bank, a deposit's start date, number and linked savings account) are under **More details**. The panel says what you changed ("Changed: name, balance."), explains a mistake in words, and shows "Saved: ..." as soon as it is kept; closing it with unsaved changes asks first. A new balance is added to the history, never written over the old one. **Add an account** (top of Accounts, or under a bank's person in the Monthly update) opens the same kind of panel for a new savings account or deposit and places it where it belongs in your order.

## Changing many accounts at once

Accounts, **Manage**, **Edit many accounts at once** is one table of every account and deposit, bank by bank in your sheet's order (a bank's own page links to the table for just that bank). It starts with the columns people use: person, name, type, rate, maturity, amount invested, notes and status; **Show every column** adds joint and second name, last four digits, linked savings account, start date, amount at maturity and deposit number. Changed rows are marked; nothing is saved until you press **Save all** (or **Discard**). Tick rows (or a whole bank) to set a type, mark joint or move them to another bank in one step. **Suggest types for empty rows** fills the blanks from the linked savings account, or from the one type a person has at that bank, and highlights them for you to check before saving. Balances are changed with **Edit** or in the monthly update.

## Rates, and where to put new money

**Rates** is only about rates. Each bank has a card: its best savings rate and best NRE deposit rate, the savings rate by balance drawn as steps, how the rates last moved, and a **Where from** line that says whether each rate was typed or pasted by you or read from the bank's page (which page, which date). Show _Banks I use_ or _All banks on file_, and sort by highest deposit, highest savings, name or oldest check; the choice is in the address. The weekly refresh runs on Monday; if it could not read a bank's page, the card says why (no AI key, the bank refused, the address has changed, the page needs a browser) and what to do.

Open a bank to change its rates in place: edit the figure and press Save. If you change a figure the bank page gave, pick why it was wrong; the refresh checks the page again next time, takes the rate back when the page agrees with you, and otherwise saves a rule (shown under _How it is read_, with an on and off switch, and you can write your own). _History and log_ shows the best rates over time and every change with the old and new figure, who made it and why. Paste your notes or add a rate under _Add or import_.

**New money** answers one question: where should this amount go? Type only the amount (25 lakh or 2500000). The app looks at the savings rates and the fixed-deposit rates of every term on file, after tax (NRE interest is not taxed in India; NRO is, at the rate in Settings), and gives **five options, each with its reasons, and one recommendation**:

- **Highest return**: the most interest whatever the term, inside insurance. It ignores how the money is spread, so it is never the recommendation.
- **Balanced**: good rates, no bank above a set share, part kept in savings.
- **Ladder**: the deposit part split over several terms (6, 12, 24, 36 months by default), so money keeps coming free.
- **Safest spread**: as many banks as it takes, none above a smaller share.
- **Stay flexible**: half in savings and the rest in short deposits.

Every option stays inside the deposit-insurance limit at each bank for the chosen name, leaving a buffer for the interest that will be added, and counts what is already there (savings and deposits of the bank together, joint accounts under their names in order, foreign banks left out). The recommendation is the option that earns most among those that meet every check: inside the limit, spread over banks, part free to withdraw any time, all of the amount placed. Each option shows its lines (bank, product and term, rate, amount, interest a year, room left), what it earns over plain savings, the largest bank share, how much is free any time and within a year, and its cautions (stale rates, money that does not fit). If no fixed-deposit rates are on file the page says so at the top, since a savings-only plan understates what the money could earn. Whose money and NRE or NRO are links under the amount; each person has their own insurance room at each bank. All the numbers (longest terms, ladder terms, bank shares, the share kept in savings, the insurance buffer, the smallest deposit) are in Settings → Rates. The other tabs show which of your holdings could earn more elsewhere and, under **Insurance room**, each ownership name at each bank against the limit.

## Tasks

**Tasks** are grouped as overdue, due in the next 7 days, later and no date. Tick the circle when a task is done; _Not needed_ drops it. Each task links to the account, bank or page it concerns. Finished and dropped tasks are on the second tab, with a way back.

**Banks that refuse automated visits.** Some banks (ESAF, HDFC, Equitas, Yes Bank, AU, IDFC First, IndusInd, RBL) answer a program with "Access Denied" or "request rejected", and a real browser run by a program is refused the same way. That is not worked around. Three things are done instead: the bank's own PDF rate sheets are read where they exist (AU); a labelled public comparison page is read when the bank's own page cannot be (marked third party, with its date, and it never removes a rate already on file); and each bank row in Settings → Bank rate pages has **Paste the page instead**: open the page in your own browser, press Ctrl+A then Ctrl+C, and paste. The AI reads the rates from the text and saves them like a refresh.

**Check sync (Settings → Bank rate pages).** Every listed bank has a **Check sync** button. It reads the saved page (and the bank's own published sheets), asks your AI to find the rates in it, and tells you step by step whether the weekly refresh will work: the page read, the number of characters, and how many fixed-deposit and savings rates were found. Nothing is saved. The check runs from the app's server, while the weekly refresh runs from GitHub, so a page can behave differently in the two places; if the check passes and the weekly run still fails, say so and the page is looked at again.

## Rates from banks that block automatic reading

Every bank with a rate page saved in Settings is read, including banks where you hold nothing yet (so you can compare before you move money). When a bank's own page cannot be read by a program, the weekly job reads the bank's published rate-sheet PDFs where they exist (AU Small Finance Bank), and otherwise public comparison pages, which are marked **Reference only (third party)** with the date to check. A comparison page never deletes a rate that is not on it. If nothing can be read, the reason is shown beside the bank in Settings; paste the rates from your notes on the Rates page. The program does not pretend to be a browser and does not get around a block.


## Savings interest from the Rates list, and recently added deposits

- A savings account with no rate of its own is estimated at the rate on the **Rates** list for its bank, its kind (NRE or NRO) and the slab its balance falls in. The flat figure in Settings is used only when the list has nothing for that bank.
- **Recently added deposits** are their own source on the "I need money" page: a deposit booked within the number of days set in Settings (default 90) can be broken with little interest lost, so it ranks right after deposits that mature in time. You can change its priority or switch it off in Settings > Where money may come from.
- **Gifts**: on Others > Money lent, choose *Gift (will not come back, not counted)*, or mark an existing loan as a gift. It stays on the list for the record but is left out of net worth, totals, reminders and the monthly update.


## AI key: OpenRouter with automatic fallback

In **Settings > Bank emails and AI** choose **OpenRouter** and paste a free key from openrouter.ai/keys (the key is write-only). The reader asks OpenRouter for its free text models, orders them (large instruction models first, reasoning models last) and tries them one after another: if one is busy, rate limited, withdrawn or does not answer in the expected form, the next one is used, up to six per request. Groq and Google Gemini still work as before. To check the chain at any time, run **Check email and AI reading** in GitHub > Actions: it reads back a made-up alert and lists the models in the order they will be tried. Free models have daily limits; adding a small credit on openrouter.ai raises them.

**Testing the AI connection.** Settings > Connections shows which AI service is connected, when it was last tested and how it went. **Test the AI connection** asks the service to read a made-up bank alert and says what worked or what to fix (for example a key with no free access). The key is used once on the server for the test and is never shown. The same check runs in GitHub > Actions > *Check email and AI reading*, which also checks the Gmail label.


## Reports

**Reports** (What we hold) shows summaries laid out like a sheet, each with a grand total, a group-by switch and a **Download CSV** button. *Deposits*: the maturity summary (what matures when, by date, month, quarter, financial year or year), the start summary (what was booked when), deposits by bank, person, NRE/NRO, rate or term, and interest by financial year per person. *Mutual funds*: funds by fund, person, kind, fund house, goal (a total per goal, funds split between goals together, and "No goal" last) or start date, the SIP summary, money in and out by month or year, and how long the units have been held. The person chips narrow every report to one person. Cash held by another person appears under **Other holdings** on the Accounts page, after the banks.

**Deposit numbers are shown in full.** The deposit (FD) number is kept whole and shown on the Accounts page, the Monthly update and each deposit's page; account numbers and PANs stay masked to the last four digits. Import your workbook again (Import, "Update order, names and links") and the numbers written as *FD Number : …* in your sheet are filled in for the deposits that already exist. To change one, press Edit on the deposit and type the number under Deposit number.

The research behind the Investments pages (what the best apps show, how each measure is worked out, what the free data cannot give) is in `docs/INVESTMENTS-DESIGN.md`.
