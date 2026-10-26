# Family Wealth OS: user guide

For Rupash and Ragini. Everything here describes what the app does today. Items marked *(waiting)* need something from you first (see `docs/NEEDS-FROM-YOU.md`).

## What the numbers mean

- **Verified** is the last balance you entered or an official statement showed, with its date.
- **Estimated today** is the verified figure moved forward: fixed deposits by their own interest terms, savings at an assumed rate, mutual funds by the latest published NAV, Singapore dollars by the latest exchange rate. Each figure is labelled *calculated*, *estimated* or *carried forward*.
- An asset with no value is listed but never counted as zero. Insurance cover and matured deposits you have not confirmed are never counted in net worth.
- Money you have lent is shown as owed, not as cash.

## Monthly routine (about 5 minutes)

1. Open **Monthly update**. The top box says which banks are up to date for the month, which are waiting for a value, and how each latest balance arrived (email, you, a statement, the imported sheet or a calculation).
2. Work down the banks that are waiting. Type the new balance and press Enter for the next one, or paste a column from Excel or your bank app into the first box. **Same** keeps one balance as it was; **Nothing changed at (bank)** does it for the whole bank. A note under a box tells you how far the new figure is from the last, and warns about a likely typing slip.
3. Press **Save**. Nothing is stored until then, and **Discard** drops the lot. The dashboard and the history chart update.
4. Deposits are worked out from their terms and sit in a closed box under each bank; only a matured deposit needs you to say where the money went. Property, pension, shares and money lent are on the second tab, **Property, loans and other**.
5. Check **Bank emails** for balances read from your email that are waiting for you, and **Tasks** for anything the app has raised.

## Bank emails

Forward bank alerts to the Gmail label shown in Settings. A balance from the bank's own address that matches exactly one of your accounts is recorded by itself. Everything else waits under **Needs your review** with the reason in plain words ("it did not come from the bank's own address", "the amount is very different from the last value"). Choose the account and press **Apply**, or **Ignore** (you can put an ignored message back). **Recorded** lists what was taken in, **Skipped** lists what was set aside and why (not a balance email, older than what you have, ignored by you, reader problems), and **Automation** shows when the email reader, market data, daily summary and rate pages last did their work.

## Import

**Import** has four tabs. **Workbook**: apply your sheet's layout (safe to repeat) or, once, import the whole workbook. **Fund statement (CAS)**: upload a CAMS/KFintech/MF Central statement, or forward it by email; the password is the one you chose, usually your PAN in capitals. **Fund transactions (CSV)**: upload the transactions export of an investment app (Kuvera layout: Date, Folio Number, Name of the Fund, Order, Units, NAV, Current Nav, Amount). Choose all the files at once and pick the person for each (the first name in the file name is pre-selected). Press **Preview** to see, per fund, whether it updates a fund you have or adds a new one, with units, amount invested and value; then **Import**. Folios of the same fund are combined; importing a file twice adds nothing twice; digital gold (no folio) is left out. **Tax statement (26AS, AIS)**: upload Form 26AS or the AIS; the date of birth saved in Settings opens a protected PDF. Each tab shows the last import result and anything that needs a look.

## Fixed deposits

**Deposits** has three tabs: Deposits (every deposit with its bank, owner, rate, maturity date and the amount at maturity), Maturities (what to confirm, what matures soon, a calendar) and Insurance cover. A matured deposit stays out of net worth until you say where the money went. The insured-limit view shows, per bank, each ownership name as written against the ₹5 lakh deposit insurance limit: Rupash, Ragini, Rupash & Ragini and Ragini & Rupash are four different names, each insured separately (so up to ₹20 lakh at one bank), and the order of the names matters. Set the second name of each joint account under **Correct tags and details** (Joint with; Swap names reverses the order); until then a joint account is grouped under its first name.

## Mutual funds and goals

- **Investments, Match funds** matches each fund in your sheet to the official scheme list once; you confirm the match. (The old Funds address still works and opens this tab.) **Investments, Update funds** is the monthly entry of units and prices.
- **Goals** has one progress card per goal: how much of the cost is set aside today, how much the projection covers, the extra to put in each month, and the funds set aside for it. Add a goal with just a name; set a target and date later under *Edit this goal*. The second tab, *Money not set aside*, lists each holding with the share no goal claims, so you can set it aside in one step. A holding can be split across goals but never above 100%.

## Can I retire now?

Open **Retire**. The verdict stays at the top while you work in the tabs below it: *Your inputs* (about you, spending and saving, market assumptions; Save keeps them), *Compare* (three scenarios, retirement ages, the effect of common changes), *Range of outcomes* and *Corpus and method*. The result is one of:

- **Meets the plan** under your assumptions,
- **Shortfall**, with the size of the gap and what would close it (spend less, retire later, save more),
- **Cannot assess**, with the missing item named.

It never says "safe". A range of outcomes (market ups and downs) is shown next to the single projection. The public sample at `/demo/retire` uses made-up numbers.

## Tax

- **Tax** (redemption simulator): enter the lots of a fund and the amount to redeem. It shows first-in-first-out lots, short or long term, exit load, the allowance used, tax at source for non-residents and the refund expected on filing. The harvest suggestion never trades for you.
- **Tax filing papers** (`/tax/filing`): fixed-deposit interest per person and financial year (taxable for NRO, exempt for NRE, joint accounts flagged), an optional tax-at-source estimate at a rate you type, a CSV download and a checklist of documents. Capital-gains schedules *(waiting for the consolidated statements)*.
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

**Tax** shows, per person, which funds to sell, how much, the gain realised, and how much to **buy back** afterwards. Each harvest creates a
**Tax refunds to claim** record by itself (expected tax withheld and expected refund). Update it as the sale happens, the return is filed
and the refund arrives; **Download as CSV** gives it to your adviser. NRO interest tax is handled on the filing papers because the refund
depends on your total Indian income. The app prepares figures; the return itself is filed on the income-tax portal using Form 26AS and the
Annual Information Statement, which the app cannot download for you.

## Fund statements (CAS) and exact harvesting

Ask CAMS/KFintech (or MF Central) for a **detailed** statement from the first investment to today, for each person, and forward the
e-mail to your `FWOS/Inbox` label. The inbox job opens it with the PAN saved in Settings, finds each fund by ISIN (or name and folio),
adds funds it does not know, stores every transaction and updates invested amount, first purchase date, SIP and value. You can also upload
the PDF under **Import** (type the PAN once to open it; it is not saved). From then on harvesting works from real purchase lots, oldest units
first, includes funds with a running SIP, and counts long-term gains you have already realised this year.

## Who can open the handbook, and when

Settings → Emergency information: the read-only family login can open the handbook always, only after nobody from the household has signed
in for a number of days, or only when you release it. Release or lock it again with one button. Members always have access.

## Returns, capital gains and the summary

- **Investments** shows the annual return (XIRR) per fund, per person and for the household from the imported fund statements, and a chart of money put in over time. Funds without a statement are not counted, and the page says how many are.
- **Tax filing papers** lists every fund sale of the year, short and long term, with the estimated tax, and downloads the schedule 112A rows per person. Compare the column order with the portal's current template before uploading. Units bought before 1 February 2018 need the 31 January 2018 value per unit, which the file leaves blank. Each person's FD interest can be compared with the tax shown in Form 26AS.
- **Lent, policies, property** also shows property, NPS, ULIP and foreign-currency balances with the exchange rate used.
- The daily summary now also carries the tax-harvest deadline and amounts, refunds still to claim, and on the first of each month a month-in-review line per person.

## Changing the order

Accounts → **Manage** → **Change the order** lists your banks and, inside each, its rows. Drag a bank or a row, or use the arrow buttons (they work from the keyboard), then press **Save this order**. Accounts and the monthly update follow the new order from then on. Uploading your workbook again with "Apply the sheet layout" sets the order back to the sheet's.

## Form 26AS and the AIS

Tax filing papers → "What the tax department holds". Download **Form 26AS** from TRACES (PDF, text or HTML; the PDF opens with your date of birth, which the app already has from Settings) and the **Annual Information Statement** from the income-tax e-filing portal (PDF or JSON), then upload them there, or e-mail them to your inbox label and they are read by themselves. The app lists each deductor and the tax credited, then compares it with the tax it expected on your deposit interest and fund sales, and compares the AIS's interest, dividends and fund sales with your own records. Differences are shown for you to check; nothing is changed automatically. The department does not publish the exact file layouts, so the reader looks for the parts every version has; if it cannot read a file, forward it by e-mail and an AI reader (the key in Settings) tries, marking the result "read by AI: check the figures".

## Getting your fund statements by e-mail

1. Go to the CAMS or KFintech statement page (or MF Central) and request a **Consolidated Account Statement**: type **Detailed**, period **from the first investment to today**, include folios with zero balance, to the Gmail address the app reads.
2. When the form asks for a password, **type your PAN in capital letters** (the same one saved in Settings). The password is whatever you choose on that form.
3. In Gmail, make a filter: from `camsonline.com`, `kfintech.com`, `mfcentral.com`, `cdslindia.com` or `nsdl.com` and has an attachment, then apply the label `FWOS/Inbox`. Statements are then imported by themselves, now and when the registrars send you monthly ones.

## Correct tags and details

Accounts → **Correct tags and details** is one grid of every account and deposit, bank by bank in your sheet's order. Fix the type (NRE, NRO, FCNR, savings, resident, joint, other), the joint flag, last four digits, the savings account a deposit is linked to, label, note, person, bank and status, and a deposit's rate, dates, amount invested, amount at maturity and number. Changed rows are marked; nothing is saved until you press **Save all** (or **Discard**). Tick rows (or a whole bank) to set a type, mark joint or move them to another bank in one step. **Suggest types for empty rows** fills the blanks from the linked savings account, or from the one type a person has at that bank, and highlights them for you to check before saving. Balances are not here: they change only through the monthly update.

## Rates, and where to put new money

**Rates** is only about rates. Each bank has a card: its best savings rate and best NRE deposit rate, the savings rate by balance drawn as steps, how the rates last moved, and a **Where from** line that says whether each rate was typed or pasted by you or read from the bank's page (which page, which date). Show *Banks I use* or *All banks on file*, and sort by highest deposit, highest savings, name or oldest check; the choice is in the address. The weekly refresh runs on Monday; if it could not read a bank's page, the card says why (no AI key, the bank refused, the address has changed, the page needs a browser) and what to do.

Open a bank to change its rates in place: edit the figure and press Save. If you change a figure the bank page gave, pick why it was wrong; the refresh checks the page again next time, takes the rate back when the page agrees with you, and otherwise saves a rule (shown under *How it is read*, with an on and off switch, and you can write your own). *History and log* shows the best rates over time and every change with the old and new figure, who made it and why. Paste your notes or add a rate under *Add or import*.

**New money** is where an amount is placed. Type an amount (25 lakh or 2500000), the account type and whose money; it is spread over the banks that pay most after tax, never above the insurance limit per person per bank. The other tabs show which of your holdings could earn more elsewhere and how much insurance room is left at each bank.

## Tasks

**Tasks** are grouped as overdue, due in the next 7 days, later and no date. Tick the circle when a task is done; *Not needed* drops it. Each task links to the account, bank or page it concerns. Finished and dropped tasks are on the second tab, with a way back.


## Rates from banks that block automatic reading

Every bank with a rate page saved in Settings is read, including banks where you hold nothing yet (so you can compare before you move money). When a bank's own page cannot be read by a program, the weekly job reads the bank's published rate-sheet PDFs where they exist (AU Small Finance Bank), and otherwise public comparison pages, which are marked **Reference only (third party)** with the date to check. A comparison page never deletes a rate that is not on it. If nothing can be read, the reason is shown beside the bank in Settings; paste the rates from your notes on the Rates page. The program does not pretend to be a browser and does not get around a block.
